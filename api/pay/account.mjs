import { customerFromRequest, json, sessionCookie } from "./_lib/session.mjs";
import { isTestMode, stripe } from "./_lib/stripe.mjs";

const LIVE_SUB = new Set(["active", "past_due", "trialing", "unpaid", "incomplete"]);

function itemsTotal(items) {
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

function planFromSchedule(schedule, now) {
  const last = schedule.phases.length - 1;
  return schedule.phases.map((phase, i) => ({
    amount: itemsTotal(phase.items),
    interval: phase.items[0]?.price?.recurring?.interval ?? "month",
    start: phase.start_date,
    end: phase.end_date,
    // After the last phase a released schedule keeps billing at that price.
    ongoing: i === last && schedule.end_behavior === "release",
    current: phase.start_date <= now && now < phase.end_date,
  }));
}

export async function GET(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);

  try {
    const now = Math.floor(Date.now() / 1000);
    const [customer, subs, schedules, invoices] = await Promise.all([
      stripe("GET", `customers/${customerId}`, { expand: ["invoice_settings.default_payment_method"] }),
      stripe("GET", "subscriptions", {
        customer: customerId,
        status: "all",
        limit: 10,
        expand: ["data.default_payment_method", "data.items.data.price"],
      }),
      stripe("GET", "subscription_schedules", { customer: customerId, limit: 10, expand: ["data.phases.items.price"] }),
      stripe("GET", "invoices", { customer: customerId, limit: 24 }),
    ]);
    if (customer.deleted) return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });

    const sub = subs.data.find((s) => LIVE_SUB.has(s.status)) ?? null;
    const schedule =
      schedules.data.find((s) => s.status === "active" && s.subscription === sub?.id) ??
      schedules.data.find((s) => s.status === "not_started") ??
      null;

    let plan = [];
    if (schedule) {
      plan = planFromSchedule(schedule, now);
    } else if (sub) {
      plan = [
        {
          amount: itemsTotal(sub.items.data),
          interval: sub.items.data[0]?.price?.recurring?.interval ?? "month",
          start: sub.start_date,
          end: null,
          ongoing: true,
          current: true,
        },
      ];
    }

    let nextCharge = null;
    if (sub) {
      const date = sub.items.data[0]?.current_period_end ?? null;
      let amount = itemsTotal(sub.items.data);
      try {
        const preview = await stripe("POST", "invoices/create_preview", { customer: customerId, subscription: sub.id });
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
          const pays = await stripe("GET", "invoice_payments", { invoice: inv.id, expand: ["data.payment.payment_intent"] });
          if (pays.data.some((p) => p.payment?.payment_intent?.status === "processing")) processing.add(inv.id);
        }),
    );

    let pm = sub?.default_payment_method || customer.invoice_settings?.default_payment_method || null;
    if (!pm && schedule?.default_settings?.default_payment_method) {
      pm = await stripe("GET", `payment_methods/${schedule.default_settings.default_payment_method}`);
    }

    return json({
      testMode: isTestMode(),
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
          url: inv.hosted_invoice_url,
          pdf: inv.invoice_pdf,
        })),
    });
  } catch (err) {
    console.error("account failed", err.message);
    if (err.status === 404) return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });
    return json({ error: "Couldn't load your account right now. Refresh to try again." }, 500);
  }
}
