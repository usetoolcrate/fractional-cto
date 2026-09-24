import { loadAccount } from "../_lib/account.mjs";
import { customerFromRequest, json, sessionCookie, sessionRevoked } from "../_lib/session.mjs";
import { isTestMode } from "../_lib/stripe.mjs";

export async function GET(request) {
  const customerId = customerFromRequest(request);
  if (!customerId) return json({ error: "Not signed in" }, 401);

  try {
    const account = await loadAccount(customerId);
    if (!account || sessionRevoked(request, account.customer)) {
      return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });
    }
    const { customer, ...visible } = account;
    return json({ testMode: isTestMode(), ...visible });
  } catch (err) {
    console.error("account failed", err.message);
    if (err.status === 404) return json({ error: "Not signed in" }, 401, { "Set-Cookie": sessionCookie(null) });
    return json({ error: "Couldn't load your account right now. Refresh to try again." }, 500);
  }
}
