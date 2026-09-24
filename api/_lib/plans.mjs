// "Starts when they pay" plans.
//
// Until the client's first payment, the plan lives only in the customer's
// metadata (pending_plan, compact JSON). The client pays the first month on a
// Stripe Checkout page, which creates the subscription on that day and saves
// the payment method for autopay. reconcilePending() then turns that
// subscription into the full phased schedule, counting months from the day
// they paid. It runs on the checkout return, on /payments loads and on admin
// loads, so it doesn't depend on webhooks.
import crypto from "node:crypto";
import { adminStripe } from "./stripe.mjs";

const LIVE = new Set(["active", "trialing", "past_due", "incomplete", "unpaid"]);

// { id, due: "YYYY-MM-DD", p: [{ i: [[priceId, amountCents, productId], …], m: months (0 = ongoing) }, …] }
export function decodePending(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && Array.isArray(v.p) && v.p.length ? v : null;
  } catch {
    return null;
  }
}

export function encodePending(plan) {
  const s = JSON.stringify(plan);
  if (s.length > 500) throw new Error("That plan has too many items to wait for a first payment. Use a fixed start date instead.");
  return s;
}

export function newPendingId() {
  return crypto.randomBytes(6).toString("hex");
}

export function pendingView(p) {
  const phases = p.p.map((ph) => ({
    amount: ph.i.reduce((s, it) => s + it[1], 0),
    months: ph.m || null,
    ongoing: !ph.m,
    items: ph.i.map(([price, amount, product]) => ({ price, amount, product })),
  }));
  return { id: p.id, due: p.due, phases, first: phases[0].amount };
}

function monthsBetween(a, b) {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
}

// Turn the subscription created by the first payment into the phased plan.
export async function reconcilePending(customerId, customer) {
  const c = customer || (await adminStripe("GET", `customers/${customerId}`));
  const pending = decodePending(c.metadata?.pending_plan);
  if (!pending) return false;
  const subs = await adminStripe("GET", "subscriptions", { customer: customerId, status: "all", limit: 20 });
  const sub = subs.data.find((s) => s.metadata?.portal_plan === pending.id && LIVE.has(s.status));
  if (!sub) return false;

  const needsSchedule = pending.p.length > 1 || pending.p[0].m > 0;
  if (needsSchedule && !sub.schedule) {
    const sched = await adminStripe("POST", "subscription_schedules", { from_subscription: sub.id });
    const currentStart = sched.phases[0].start_date;
    // Months already billed if this runs late; normally 0.
    let elapsed = Math.max(0, monthsBetween(sub.start_date, currentStart));
    const phases = [];
    for (const ph of pending.p) {
      let months = ph.m;
      if (months && elapsed) {
        const used = Math.min(elapsed, months);
        months -= used;
        elapsed -= used;
        if (months === 0) continue;
      }
      phases.push({
        ...(phases.length === 0 ? { start_date: currentStart } : {}),
        items: ph.i.map(([price]) => ({ price, quantity: 1 })),
        duration: { interval: "month", interval_count: months || 1 },
        proration_behavior: "none",
      });
    }
    const last = pending.p.at(-1);
    await adminStripe("POST", `subscription_schedules/${sched.id}`, {
      phases,
      end_behavior: last.m ? "cancel" : "release",
      proration_behavior: "none",
    });
  }
  await adminStripe("POST", `customers/${customerId}`, {
    metadata: { pending_plan: "", plan_started_at: String(sub.start_date) },
  });
  return true;
}

// Stripe Checkout page for the first payment: card or bank, saved for autopay.
export async function startCheckout(customerId, origin) {
  const customer = await adminStripe("GET", `customers/${customerId}`);
  const pending = decodePending(customer.metadata?.pending_plan);
  if (!pending) return { error: "There's no plan waiting to start." };
  if (await reconcilePending(customerId, customer)) return { alreadyStarted: true };

  const session = await adminStripe("POST", "checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    line_items: pending.p[0].i.map(([price]) => ({ price, quantity: 1 })),
    payment_method_types: ["card", "us_bank_account"],
    subscription_data: { metadata: { portal: "schottky", portal_plan: pending.id } },
    success_url: `${origin}/payments?started={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/payments`,
  });
  return { url: session.url };
}
