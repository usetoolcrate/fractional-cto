import crypto from "node:crypto";
import { sendEmail, signInEmail } from "../_lib/email.mjs";
import { json, makeLinkToken } from "../_lib/session.mjs";
import { adminStripe } from "../_lib/stripe.mjs";

// "Don't have your code?" Emails a one-time link that signs the client into
// /payments. The reply is the same whether or not the email is on file, and
// takes about the same time, so this can't be used to find out who's a client.
const SENT = "If that email is on file, a sign-in link is on its way. It works once and expires in 30 minutes.";

export async function POST(request) {
  const started = Date.now();
  const done = async (body, status = 200) => {
    const wait = 2500 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return json(body, status);
  };

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter the email address I send your invoices to." }, 400);
  }

  try {
    const list = await adminStripe("GET", "customers", { email, limit: 10 });
    const customer = list.data
      .filter((c) => !c.deleted && c.metadata?.portal === "schottky")
      .sort((a, b) => b.created - a.created)[0];
    if (!customer) return done({ ok: true, message: SENT });

    // At most one link a minute per client, so nobody can flood their inbox.
    const now = Math.floor(Date.now() / 1000);
    if (now - (Number(customer.metadata?.login_link_sent_at) || 0) < 60) return done({ ok: true, message: SENT });

    const nonce = crypto.randomBytes(12).toString("hex");
    await adminStripe("POST", `customers/${customer.id}`, {
      metadata: { login_link_nonce: nonce, login_link_sent_at: String(now) },
    });
    // The token rides in the #fragment, which browsers never send to servers or in referrers.
    const url = `${new URL(request.url).origin}/payments#link=${makeLinkToken(customer.id, nonce)}`;
    await sendEmail({ to: customer.email, ...signInEmail({ name: customer.name, url }), bcc: false });
    return done({ ok: true, message: SENT });
  } catch (err) {
    console.error("email link failed", err.message);
    return json({ error: "Couldn't send a link right now. Try again in a minute, or sign in with your client code." }, 500);
  }
}
