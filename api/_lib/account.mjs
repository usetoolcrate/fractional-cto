// Builds one client's billing picture from Stripe. Used by the client portal
// (/api/pay/account, restricted key) and the admin page (full key, detail on).
import { stripe } from "./stripe.mjs";

const LIVE_SUB = new Set(["active", "past_due", "trialing", "unpaid", "incomplete"]);

export function itemsTotal(items) {
  return items.reduce((sum, it) => sum + (it.price?.unit_amount ?? 0) * (it.quantity ?? 1), 0);
}

function describePaymentMethod(pm) {
  if (!pm || typeof pm !== "object") return null;
  if (pm.type === "card" && pm.card) {
    const brand = (pm.card.display_brand || pm.card.brand || "card").replace(/_/g, " ");
    const pretty = brand.replace(/\b\w/g, (c) => c.toUpperCase());
    return { kind: "card", label: `${pretty} •••• ${pm.card.last4}` };
  }
  if (pm.type === "us_bank_account" && pm.us_bank_account) {
    return { kind: "bank", label: `${pm.us_bank_account.bank_name || "Bank account"} •••• ${pm.us_bank_account.last4}` };
  }
  if (pm.type === "link") return { kind: "link", label: "Link" };
  return { kind: pm.type, label: pm.type.replace(/_/g, " ") };
}

function itemDetail(items) {
  return items.map((it) => ({
    price: it.price?.id,
    product: typeof it.price?.product === "string" ? it.price.product : it.price?.product?.id,
    amount: (it.price?.unit_amount ?? 0) * (it.quantity ?? 1),
  }));
}

function planFromSchedule(schedule, now, detail) {
  const last = schedule.phases.length - 1;
  return schedule.phases.map((phase, i) => ({
    amount: itemsTotal(phase.items),
    interval: phase.items[0]?.price?.recurring?.interval ?? "month",
    start: phase.start_date,
    end: phase.end_date,
    // After the last phase a released schedule keeps billing at that price.
    ongoing: i === last && schedule.end_behavior === "release",
    current: phase.start_date <= now && now < phase.end_date,
    ...(detail ? { items: itemDetail(phase.items) } : {}),
  }));
}

export async function loadAccount(customerId, { admin = false, detail = false } = {}) {
  const call = (method, path, params) => stripe(method, path, params, { admin });
  const now = Math.floor(Date.now() / 1000);
  const [customer, subs, schedules, invoices] = await Promise.all([
    call("GET", `customers/${customerId}`, { expand: ["invoice_settings.default_payment_method"] }),
    call("GET", "subscriptions", {
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.default_payment_method", "data.items.data.price"],
    }),
    call("GET", "subscription_schedules", { customer: customerId, limit: 10, expand: ["data.phases.items.price"] }),
    call("GET", "invoices", { customer: customerId, limit: 24 }),
  ]);
  if (customer.deleted) return null;

  const sub = subs.data.find((s) => LIVE_SUB.has(s.status)) ?? null;
  const schedule =
    schedules.data.find((s) => s.status === "active" && s.subscription === sub?.id) ??
    schedules.data.find((s) => s.status === "not_started") ??
    null;

  let plan = [];
  if (schedule) {
    plan = planFromSchedule(schedule, now, detail);
  } else if (sub) {
    plan = [
      {
        amount: itemsTotal(sub.items.data),
        interval: sub.items.data[0]?.price?.recurring?.interval ?? "month",
        start: sub.start_date,
        end: null,
        ongoing: true,
        current: true,
        ...(detail ? { items: itemDetail(sub.items.data) } : {}),
      },
    ];
  }

  let nextCharge = null;
  if (sub) {
    const date = sub.items.data[0]?.current_period_end ?? null;
    let amount = itemsTotal(sub.items.data);
    try {
      const preview = await call("POST", "invoices/create_preview", { customer: customerId, subscription: sub.id });
      amount = preview.amount_due;
    } catch {
      // Keep the plain item total if the preview isn't available.
    }
    if (date) nextCharge = { date, amount };
  } else if (schedule?.status === "not_started") {
    nextCharge = { date: schedule.phases[0].start_date, amount: itemsTotal(schedule.phases[0].items) };
  }

  // ACH debits take days to clear; during that time Stripe reports the invoice
  // as open with an attempt, which must not read as "payment failed".
  const processing = new Set();
  await Promise.all(
    invoices.data
      .filter((inv) => inv.status === "open" && (inv.attempt_count ?? 0) > 0)
      .map(async (inv) => {
        try {
          const pays = await call("GET", "invoice_payments", { invoice: inv.id, expand: ["data.payment.payment_intent"] });
          if (pays.data.some((p) => p.payment?.payment_intent?.status === "processing")) processing.add(inv.id);
        } catch (err) {
          // Can't tell (e.g. the key lacks PaymentIntents: Read). Don't invite a
          // second payment for something that may be clearing; Stripe emails
          // the client if it actually failed.
          console.error("invoice_payments lookup failed", inv.id, err.message);
          processing.add(inv.id);
        }
      }),
  );

  let pm = sub?.default_payment_method || customer.invoice_settings?.default_payment_method || null;
  if (!pm && schedule?.default_settings?.default_payment_method) {
    pm = await call("GET", `payment_methods/${schedule.default_settings.default_payment_method}`);
  }

  return {
    customer,
    client: { name: customer.name || customer.email || "Client", email: customer.email },
    plan,
    nextCharge,
    autopay: describePaymentMethod(pm),
    invoices: invoices.data
      .filter((inv) => inv.status !== "draft" && inv.status !== "void")
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        created: inv.created,
        periodStart: inv.lines?.data?.[0]?.period?.start ?? inv.created,
        total: inv.total,
        remaining: inv.amount_remaining,
        status: inv.status,
        attempted: (inv.attempt_count ?? 0) > 0,
        processing: processing.has(inv.id),
        dueDate: inv.due_date,
        description: detail ? inv.description || inv.lines?.data?.[0]?.description || null : undefined,
        url: inv.hosted_invoice_url,
        pdf: inv.invoice_pdf,
      })),
    ...(detail
      ? {
          id: customer.id,
          metadata: customer.metadata || {},
          created: customer.created,
          schedule: schedule ? { id: schedule.id, status: schedule.status } : null,
          subscription: sub ? { id: sub.id, status: sub.status, items: itemDetail(sub.items.data) } : null,
        }
      : {}),
  };
}
