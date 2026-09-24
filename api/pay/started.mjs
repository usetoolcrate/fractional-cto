import { reconcilePending } from "../_lib/plans.mjs";
import { customerFromRequest, json, readSessionId } from "../_lib/session.mjs";
import { adminStripe } from "../_lib/stripe.mjs";

// Return from Stripe Checkout: confirm it was this client's session, then
// apply the full phased plan right away.
export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);
  const sessionId = await readSessionId(request);
  if (!sessionId) return json({ error: "Missing checkout session" }, 400);
  try {
    const session = await adminStripe("GET", `checkout/sessions/${sessionId}`);
    if (session.customer !== customerId || session.status !== "complete") {
      return json({ error: "That payment isn't finished." }, 409);
    }
    await reconcilePending(customerId);
    return json({ ok: true, processing: session.payment_status !== "paid" });
  } catch (err) {
    console.error("started failed", err.message);
    return json({ error: "Your payment went through, but the page couldn't refresh. Reload to see it." }, 500);
  }
}
