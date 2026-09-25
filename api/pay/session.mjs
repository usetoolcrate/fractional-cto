import { loginWithCode, redeemLink, sendSignInLink } from "../_lib/signin.mjs";
import { json, sessionCookie } from "../_lib/session.mjs";

// POST { code }  -> sign in with a client code
// POST { email } -> email a one-time sign-in link
// POST { token } -> sign in with that link
// DELETE         -> sign out
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // Treated as a missing code below.
  }
  if (body?.token) return redeemLink(body);
  if (body?.email) return sendSignInLink(body, new URL(request.url).origin);
  return loginWithCode(body);
}

export async function DELETE() {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
