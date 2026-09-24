import { customerFromRequest, json, sessionCookie, sessionRevoked } from "../_lib/session.mjs";
import { stripe } from "../_lib/stripe.mjs";

// Sends the signed-in client to Stripe's hosted screen for adding or changing
// their autopay card / bank account, then back to /payments.
export async function POST(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);

  const origin = new URL(request.url).origin;
  try {
    const customer = await stripe("GET", `customers/${customerId}`);
    if (customer.deleted || sessionRevoked(request, customer)) {
      return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });
    }
    const session = await stripe("POST", "billing_portal/sessions", {
      customer: customerId,
      return_url: `${origin}/payments`,
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION || undefined,
      flow_data: {
        type: "payment_method_update",
        after_completion: { type: "redirect", redirect: { return_url: `${origin}/payments?updated=1` } },
      },
    });
    return json({ url: session.url });
  } catch (err) {
    console.error("manage failed", err.message);
    return json({ error: "Couldn't open the payment method screen. Try again in a minute." }, 500);
  }
}
