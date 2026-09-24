// One client: GET ?id=cus_… for details; POST { id, action, … } to act on them.
// Actions: code (new sign-in code, optionally emailed), plan (create a phased
// plan: starts on a fixed date, or when the client makes the first payment),
// plan-cancel (only before any charge), addon-add / addon-remove, request
// (one-off invoice Stripe emails).
import { loadAccount } from "../_lib/account.mjs";
import { guard, readJson } from "../_lib/admin.mjs";
import { centralMidnight, monthlyPrice, productNames, todayCentral } from "../_lib/billing.mjs";
import { generateCode, hashCode } from "../_lib/codes.mjs";
import { decodePending, encodePending, newPendingId, reconcilePending } from "../_lib/plans.mjs";
import { inviteEmail, sendEmail } from "../_lib/email.mjs";
import { json } from "../_lib/session.mjs";
import { adminStripe, dashboardUrl, isTestMode } from "../_lib/stripe.mjs";

const validId = (id) => /^cus_[A-Za-z0-9]+$/.test(id || "");
const cents = (v) => Math.round(Number(v) * 100);

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!validId(id)) return json({ error: "Unknown client" }, 400);
  try {
    let [account, names] = await Promise.all([loadAccount(id, { admin: true, detail: true }), productNames()]);
    if (!account) return json({ error: "That client was deleted in Stripe." }, 404);
    if (account.needsReconcile) {
      await reconcilePending(id, account.customer);
      account = await loadAccount(id, { admin: true, detail: true });
    }
    const named = (items = []) => items.map((it) => ({ ...it, name: names[it.product] || "Item" }));
    account.plan = account.plan.map((p) => ({ ...p, items: named(p.items) }));
    if (account.subscription) account.subscription.items = named(account.subscription.items);
    if (account.pending) account.pending.phases = account.pending.phases.map((p) => ({ ...p, items: named(p.items) }));
    const { customer, needsReconcile, ...visible } = account;
    return json({ testMode: isTestMode(), dashboard: dashboardUrl(`customers/${id}`), ...visible });
  } catch (err) {
    console.error("client load failed", err.message);
    return json({ error: `Couldn't load this client: ${err.message}` }, err.status === 404 ? 404 : 500);
  }
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!validId(body.id)) return json({ error: "Unknown client" }, 400);
  const idem = (kind) => (body.requestId ? `${kind}-${body.requestId}` : undefined);

  try {
    switch (body.action) {
      case "code":
        return await issueCode(body, idem);
      case "plan":
        return await createPlan(body, idem);
      case "plan-cancel":
        return await cancelPlan(body);
      case "addon-add":
        return await changeAddon(body, "add");
      case "addon-remove":
        return await changeAddon(body, "remove");
      case "request":
        return await paymentRequest(body, idem);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(`client ${body.action} failed`, err.message);
    return json({ error: `Stripe said: ${err.message}` }, 500);
  }
}

async function issueCode({ id, send }, idem) {
  const customer = await adminStripe("GET", `customers/${id}`);
  const initials = (customer.name || "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3);
  const code = generateCode(customer.metadata?.portal_prefix || initials);
  const now = Math.floor(Date.now() / 1000);
  await adminStripe("POST", `customers/${id}`, {
    metadata: { portal: "schottky", portal_code_sha256: hashCode(code), code_issued_at: String(now) },
  });
  if (!send) return json({ code, emailed: false });

  const account = await loadAccount(id, { admin: true });
  const mail = inviteEmail({
    name: customer.name,
    code,
    nextCharge: account?.nextCharge,
    hasAutopay: Boolean(account?.autopay),
    pending: account?.pending,
  });
  try {
    await sendEmail({ to: customer.email, ...mail, idempotencyKey: idem("invite") });
  } catch (err) {
    // The new code is already live; show it so it can be sent by hand.
    const notReady = /not verified|domain/i.test(err.message);
    return json({
      code,
      emailed: false,
      emailError: notReady
        ? "Sending from schottky.com isn't switched on yet: the email service is still verifying the domain. The code above is live, so send it yourself for now."
        : `${err.message} The code above is live, so send it yourself.`,
    });
  }
  await adminStripe("POST", `customers/${id}`, { metadata: { invite_sent_at: String(now) } });
  return json({ code, emailed: true, to: customer.email });
}

async function createPlan({ id, start, phases, mode }, idem) {
  const account = await loadAccount(id, { admin: true, detail: true });
  if (account?.schedule || account?.subscription || account?.pending) {
    return json({ error: "This client already has a plan. Use add-ons, cancel it first, or change it in the Stripe dashboard." }, 409);
  }
  if (!Array.isArray(phases) || phases.length < 1 || phases.length > 6) return json({ error: "A plan needs 1 to 6 phases." }, 400);
  const payToStart = mode === "pay";
  const today = todayCentral();
  if (!start || start < today) return json({ error: payToStart ? "Pick a due date of today or later." : "Pick a start date of today or later." }, 400);
  const startDate = start === today ? "now" : centralMidnight(start);
  if (!startDate) return json({ error: "That date isn't valid." }, 400);

  const clean = [];
  for (const [i, p] of phases.entries()) {
    const name = String(p.name ?? "").trim().slice(0, 80);
    const amount = cents(p.amount);
    const ongoing = Boolean(p.ongoing);
    const months = Number(p.months);
    if (!name) return json({ error: `Phase ${i + 1} needs a name (it shows on invoices).` }, 400);
    if (!(amount >= 100 && amount <= 5_000_000)) return json({ error: `Phase ${i + 1} needs an amount between $1 and $50,000.` }, 400);
    if (ongoing && i !== phases.length - 1) return json({ error: "Only the last phase can be ongoing." }, 400);
    if (!ongoing && !(Number.isInteger(months) && months >= 1 && months <= 60)) {
      return json({ error: `Phase ${i + 1} needs 1 to 60 months.` }, 400);
    }
    clean.push({ name, amount, ongoing, months: ongoing ? 1 : months });
  }

  if (payToStart) {
    // Nothing is charged yet: the plan waits in metadata for the first payment.
    const p = [];
    for (const ph of clean) {
      const price = await monthlyPrice(ph.name, ph.amount);
      p.push({ i: [[price.id, ph.amount, typeof price.product === "string" ? price.product : price.product.id]], m: ph.ongoing ? 0 : ph.months });
    }
    await adminStripe("POST", `customers/${id}`, {
      metadata: { pending_plan: encodePending({ id: newPendingId(), due: start, p }) },
    });
    return json({ ok: true, pending: true }, 201);
  }

  const built = [];
  for (const p of clean) {
    const price = await monthlyPrice(p.name, p.amount);
    built.push({
      items: [{ price: price.id, quantity: 1 }],
      duration: { interval: "month", interval_count: p.months },
      proration_behavior: "none",
    });
  }
  const schedule = await adminStripe(
    "POST",
    "subscription_schedules",
    {
      customer: id,
      start_date: startDate,
      end_behavior: clean.at(-1).ongoing ? "release" : "cancel",
      default_settings: { collection_method: "charge_automatically" },
      phases: built,
    },
    { idempotencyKey: idem("plan") },
  );
  return json({ ok: true, schedule: schedule.id, status: schedule.status }, 201);
}

const itemProduct = (it) => (typeof it.price === "object" ? it.price.product : null);
const itemPrice = (it) => (typeof it.price === "object" ? it.price.id : it.price);

async function changeAddon({ id, name, amount, product }, mode) {
  const account = await loadAccount(id, { admin: true, detail: true });
  if (!account?.schedule && !account?.subscription && !account?.pending) return json({ error: "Create a plan first." }, 409);

  let price = null;
  if (mode === "add") {
    const n = String(name ?? "").trim().slice(0, 80);
    const a = cents(amount);
    if (!n) return json({ error: "Name the add-on (it shows on invoices)." }, 400);
    if (!(a >= 100 && a <= 5_000_000)) return json({ error: "Add-on amount must be between $1 and $50,000." }, 400);
    price = await monthlyPrice(n, a);
    product = typeof price.product === "string" ? price.product : price.product.id;
  } else if (!/^prod_[A-Za-z0-9]+$/.test(product || "")) {
    return json({ error: "Unknown add-on" }, 400);
  }

  if (account.pending) {
    const pending = decodePending(account.customer.metadata?.pending_plan);
    if (mode === "add") {
      if (pending.p.every((ph) => ph.i.some((it) => it[2] === product))) return json({ error: "That add-on is already on this plan." }, 409);
      for (const ph of pending.p) if (!ph.i.some((it) => it[2] === product)) ph.i.push([price.id, price.unit_amount, product]);
    } else {
      for (const ph of pending.p) ph.i = ph.i.filter((it) => it[2] !== product);
      if (pending.p.some((ph) => ph.i.length === 0)) {
        return json({ error: "That would leave a phase with nothing to bill. Cancel the plan and design it again instead." }, 409);
      }
    }
    await adminStripe("POST", `customers/${id}`, { metadata: { pending_plan: encodePending(pending) } });
  } else if (account.schedule) {
    // Resend every current and future phase in one update; anything left out is unset.
    const s = await adminStripe("GET", `subscription_schedules/${account.schedule.id}`, { expand: ["phases.items.price"] });
    const now = Math.floor(Date.now() / 1000);
    const keep = s.phases.filter((p) => p.end_date > now);
    if (mode === "add" && keep.every((p) => p.items.some((it) => itemProduct(it) === product))) {
      return json({ error: "That add-on is already on this plan." }, 409);
    }
    const phases = keep.map((p, i) => {
      let items = p.items.map((it) => ({ price: itemPrice(it), quantity: it.quantity ?? 1, product: itemProduct(it) }));
      if (mode === "add" && !items.some((it) => it.product === product)) items.push({ price: price.id, quantity: 1, product });
      if (mode === "remove") items = items.filter((it) => it.product !== product);
      return {
        ...(i === 0 ? { start_date: p.start_date } : {}),
        end_date: p.end_date,
        items: items.map(({ price: pr, quantity }) => ({ price: pr, quantity })),
        proration_behavior: "none",
      };
    });
    if (phases.some((p) => p.items.length === 0)) {
      return json({ error: "That would leave a phase with nothing to bill. Remove it in Stripe instead." }, 409);
    }
    await adminStripe("POST", `subscription_schedules/${s.id}`, { phases, proration_behavior: "none" });
  } else {
    const sub = account.subscription;
    if (mode === "add") {
      if (sub.items.some((it) => it.product === product)) return json({ error: "That add-on is already on this plan." }, 409);
      await adminStripe("POST", "subscription_items", { subscription: sub.id, price: price.id, quantity: 1, proration_behavior: "none" });
    } else {
      const raw = await adminStripe("GET", "subscription_items", { subscription: sub.id, limit: 20 });
      const item = raw.data.find((it) => (typeof it.price.product === "string" ? it.price.product : it.price.product?.id) === product);
      if (!item) return json({ error: "That add-on isn't on this plan." }, 404);
      if (raw.data.length === 1) return json({ error: "That's the only item on the plan. Cancel the plan in Stripe instead." }, 409);
      await adminStripe("DELETE", `subscription_items/${item.id}`, { proration_behavior: "none" });
    }
  }
  return json({ ok: true });
}

// Only before anything has been charged: a plan waiting for its first payment,
// or a fixed-date plan that hasn't started. Running plans are changed in Stripe.
async function cancelPlan({ id }) {
  const account = await loadAccount(id, { admin: true, detail: true });
  if (account?.pending) {
    await adminStripe("POST", `customers/${id}`, { metadata: { pending_plan: "" } });
    return json({ ok: true });
  }
  if (account?.schedule?.status === "not_started") {
    await adminStripe("POST", `subscription_schedules/${account.schedule.id}/cancel`, {});
    return json({ ok: true });
  }
  return json({ error: "This plan has already started. Cancel it in the Stripe dashboard so you can choose what happens to the current month." }, 409);
}

async function paymentRequest({ id, amount, description, daysUntilDue }, idem) {
  const a = cents(amount);
  const desc = String(description ?? "").trim().slice(0, 200);
  const days = Number(daysUntilDue ?? 14);
  if (!(a >= 100 && a <= 5_000_000)) return json({ error: "Amount must be between $1 and $50,000." }, 400);
  if (!desc) return json({ error: "Describe what the payment is for (it shows on the invoice)." }, 400);
  if (!(Number.isInteger(days) && days >= 0 && days <= 90)) return json({ error: "Due in 0 to 90 days." }, 400);

  const invoice = await adminStripe(
    "POST",
    "invoices",
    {
      customer: id,
      collection_method: "send_invoice",
      days_until_due: days,
      description: desc,
      pending_invoice_items_behavior: "exclude",
      payment_settings: { payment_method_types: ["card", "us_bank_account"] },
      metadata: { portal: "schottky" },
    },
    { idempotencyKey: idem("request") },
  );
  await adminStripe(
    "POST",
    "invoiceitems",
    { customer: id, invoice: invoice.id, amount: a, currency: "usd", description: desc },
    { idempotencyKey: idem("request-item") },
  );
  await adminStripe("POST", `invoices/${invoice.id}/finalize`, {});
  const sent = await adminStripe("POST", `invoices/${invoice.id}/send`, {});
  return json({ ok: true, number: sent.number, url: sent.hosted_invoice_url }, 201);
}
