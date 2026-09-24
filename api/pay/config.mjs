import { json } from "../_lib/session.mjs";
import { isTestMode } from "../_lib/stripe.mjs";

// Public settings the sign-in screen needs. The email route is Stripe's own
// customer-portal login page: Stripe emails the client a sign-in link.
export async function GET() {
  return json({
    emailLoginUrl: process.env.STRIPE_PORTAL_LOGIN_URL || null,
    testMode: isTestMode(),
  });
}
