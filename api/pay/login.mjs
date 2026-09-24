import { hashCode, normalizeCode } from "./_lib/codes.mjs";
import { json, makeToken, sessionCookie } from "./_lib/session.mjs";
import { stripe } from "./_lib/stripe.mjs";

const NO_MATCH = "That code didn't match an account. Check it and try again, or use your email below.";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Enter your client code." }, 400);
  }
  const code = normalizeCode(body?.code);
  if (code.length < 8 || code.length > 20) {
    return json({ error: NO_MATCH }, 401);
  }

  try {
    const found = await stripe("GET", "customers/search", {
      query: `metadata['portal_code_sha256']:'${hashCode(code)}'`,
      limit: 2,
    });
    if (found.data.length !== 1) {
      // Slow down guessing a little; codes are 50 random bits anyway.
      await new Promise((r) => setTimeout(r, 700));
      return json({ error: NO_MATCH }, 401);
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(makeToken(found.data[0].id)) });
  } catch (err) {
    console.error("login failed", err.message);
    return json({ error: "Sign-in isn't working right now. Try again in a minute." }, 500);
  }
}
