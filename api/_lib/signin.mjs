// Client sign-in for /payments: a client code, or a one-time link sent by email.
// Served by api/pay/session.mjs (kept in one function: the Hobby plan caps a
// deployment at 12 serverless functions).
import crypto from "node:crypto";
import { hashCode, normalizeCode } from "./codes.mjs";
import { sendEmail, signInEmail } from "./email.mjs";
import { json, makeLinkToken, makeToken, readLinkToken, sessionCookie } from "./session.mjs";
import { adminStripe, stripe } from "./stripe.mjs";

const NO_MATCH = "That code didn't match an account. Check it and try again, or use your email below.";
const LINK_SENT = "If that email is on file, a sign-in link is on its way. It works once and expires in 30 minutes.";
const LINK_EXPIRED = "That sign-in link has expired or was already used. Enter your email below to get a new one.";

export async function loginWithCode(body) {
  const raw = String(body?.code ?? "").trim();
  if (!raw) return json({ error: "Enter your client code." }, 400);
  const code = normalizeCode(raw);
  // Codes are 6 characters now; the upper bound keeps older, longer ones working.
  if (code.length < 6 || code.length > 20) return json({ error: NO_MATCH }, 401);

  try {
    const hash = hashCode(code);
    const found = await stripe("GET", "customers/search", {
      query: `metadata['portal_code_sha256']:'${hash}'`,
      limit: 2,
    });
    // Search lags up to a minute behind edits, so a replaced code could still be
    // found there. Confirm against the customer record itself, which is current.
    const customer = found.data.length === 1 ? await stripe("GET", `customers/${found.data[0].id}`) : null;
    if (!customer || customer.deleted || customer.metadata?.portal_code_sha256 !== hash) {
      // Slow down guessing a little.
      await new Promise((r) => setTimeout(r, 700));
      return json({ error: NO_MATCH }, 401);
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(makeToken(customer.id)) });
  } catch (err) {
    console.error("login failed", err.message);
    return json({ error: "Sign-in isn't working right now. Try again in a minute." }, 500);
  }
}

// "Don't have your code?" Emails a one-time link that signs the client into
// /payments. The reply is the same whether or not the email is on file, and
// takes about the same time, so this can't be used to find out who's a client.
export async function sendSignInLink(body, origin) {
  const started = Date.now();
  const done = async (payload, status = 200) => {
    const wait = 2500 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return json(payload, status);
  };
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter the email address I send your invoices to." }, 400);
  }

  try {
    const list = await adminStripe("GET", "customers", { email, limit: 10 });
    const customer = list.data
      .filter((c) => !c.deleted && c.metadata?.portal === "schottky")
      .sort((a, b) => b.created - a.created)[0];
    if (!customer) return done({ ok: true, message: LINK_SENT });

    // At most one link a minute per client, so nobody can flood their inbox.
    const now = Math.floor(Date.now() / 1000);
    if (now - (Number(customer.metadata?.login_link_sent_at) || 0) < 60) return done({ ok: true, message: LINK_SENT });

    const nonce = crypto.randomBytes(12).toString("hex");
    await adminStripe("POST", `customers/${customer.id}`, {
      metadata: { login_link_nonce: nonce, login_link_sent_at: String(now) },
    });
    // The token rides in the #fragment, which browsers never send to servers or in referrers.
    const url = `${origin}/payments#link=${makeLinkToken(customer.id, nonce)}`;
    await sendEmail({ to: customer.email, ...signInEmail({ name: customer.name, url }), bcc: false });
    return done({ ok: true, message: LINK_SENT });
  } catch (err) {
    console.error("email link failed", err.message);
    return json({ error: "Couldn't send a link right now. Try again in a minute, or sign in with your client code." }, 500);
  }
}

// Trade a one-time email link for the normal /payments session cookie.
export async function redeemLink(body) {
  const link = readLinkToken(body?.token);
  if (!link) return json({ error: LINK_EXPIRED }, 401);
  try {
    const customer = await adminStripe("GET", `customers/${link.customerId}`);
    if (customer.deleted || customer.metadata?.login_link_nonce !== link.nonce) return json({ error: LINK_EXPIRED }, 401);
    await adminStripe("POST", `customers/${customer.id}`, { metadata: { login_link_nonce: "" } }); // single use
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(makeToken(customer.id)) });
  } catch (err) {
    console.error("link login failed", err.message);
    return json({ error: "Sign-in isn't working right now. Try again in a minute." }, 500);
  }
}
