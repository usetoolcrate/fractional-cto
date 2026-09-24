import { startCheckout } from "../_lib/plans.mjs";
import { customerFromRequest, json, sessionCookie, sessionRevoked } from "../_lib/session.mjs";
import { adminStripe } from "../_lib/stripe.mjs";

// Client clicks "Pay and start my plan": send them to Stripe Checkout for the
// first month. The admin key is used server-side only, for this one client.
export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);
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
