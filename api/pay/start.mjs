import { reconcilePending, startCheckout } from "../_lib/plans.mjs";
import { customerFromRequest, json, sessionCookie, sessionRevoked } from "../_lib/session.mjs";
import { adminStripe } from "../_lib/stripe.mjs";

// POST {}          -> client clicked "Pay and start my plan": open Stripe Checkout
//                     for the first month.
// POST { session } -> back from Checkout: confirm it was this client's payment,
//                     then apply the full phased plan right away.
// The admin key is used server-side only, for the signed-in client.
export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    // No body: start checkout.
  }

  if (body?.session !== undefined) {
    const sessionId = String(body.session);
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ error: "Missing checkout session" }, 400);
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

  try {
    const customer = await adminStripe("GET", `customers/${customerId}`);
    if (customer.deleted || sessionRevoked(request, customer)) {
      return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });
    }
    const result = await startCheckout(customerId, new URL(request.url).origin);
    if (result.error) return json({ error: result.error }, 409);
    return json(result);
  } catch (err) {
    console.error("start failed", err.message);
    return json({ error: "Couldn't open the payment page. Try again in a minute." }, 500);
  }
}
