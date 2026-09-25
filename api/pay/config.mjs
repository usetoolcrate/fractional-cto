import { json } from "../_lib/session.mjs";
import { isTestMode } from "../_lib/stripe.mjs";

// Public settings the sign-in screen needs. "emailSignIn": clients can ask for a
// one-time sign-in link by email (our own, sent through Resend).
export async function GET() {
  return json({
    emailSignIn: Boolean(process.env.RESEND_API_KEY),
    testMode: isTestMode(),
  });
}
