import { json, makeToken, readLinkToken, sessionCookie } from "../_lib/session.mjs";
import { adminStripe } from "../_lib/stripe.mjs";

const EXPIRED = "That sign-in link has expired or was already used. Enter your email below to get a new one.";

// Trade a one-time email link for the normal /payments session cookie.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const link = readLinkToken(body?.token);
  if (!link) return json({ error: EXPIRED }, 401);
  try {
    const customer = await adminStripe("GET", `customers/${link.customerId}`);
    if (customer.deleted || customer.metadata?.login_link_nonce !== link.nonce) return json({ error: EXPIRED }, 401);
    await adminStripe("POST", `customers/${customer.id}`, { metadata: { login_link_nonce: "" } }); // single use
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(makeToken(customer.id)) });
  } catch (err) {
    console.error("link login failed", err.message);
    return json({ error: "Sign-in isn't working right now. Try again in a minute." }, 500);
  }
}
