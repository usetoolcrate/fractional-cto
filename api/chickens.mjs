import { sendEmail } from "./_lib/email.mjs";
import { json } from "./_lib/session.mjs";

// POST { name, email, phone, birds, message, website, t } from schottkyfarm.com.
// Emails the order inquiry to me with reply-to set to the buyer, so hitting
// Reply answers them. `website` is a hidden honeypot and `t` is when the form
// was shown; bots fill the first and submit instantly, so both are dropped
// silently with a normal-looking success.
const TO = process.env.CHICKENS_TO || "alex@schottky.com";

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Please fill in the form and try again." }, 400);
  }

  if (body.website || (Number(body.t) && Date.now() - Number(body.t) < 3000)) return json({ ok: true });

  const name = clean(body.name, 100);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const birds = clean(body.birds, 40);
  const message = clean(body.message, 3000);

  if (!name) return json({ error: "Please add your name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please check your email address." }, 400);

  const rows = [
    ["Name", name],
    ["Email", email],
    ["Phone", phone || "—"],
    ["How many birds", birds || "—"],
  ];
  const text = [
    "New chicken inquiry from schottkyfarm.com",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    message || "(no message)",
    "",
    "Reply to this email to answer them.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#1c1e21;font-size:16px;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2dcd0;border-radius:10px;padding:28px">
<p style="margin:0 0 16px;font-weight:700">New chicken inquiry from schottkyfarm.com</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;border-top:1px solid #e2dcd0;color:#4a4f56;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #e2dcd0">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:0 0 16px;white-space:pre-wrap">${esc(message || "(no message)")}</p>
<p style="margin:0;font-size:14px;color:#4a4f56">Reply to this email to answer them.</p>
</div></body></html>`;

  try {
    await sendEmail({
      to: TO,
      subject: `Chicken inquiry: ${name}${birds ? ` (${birds})` : ""}`,
      text,
      html,
      // Not from alex@ itself: Gmail files mail "from me, to me" outside the inbox.
      from: "Chicken orders <chickens@schottky.com>",
      replyTo: email,
      bcc: false,
    });
  } catch (err) {
    console.error("chicken inquiry failed", err.message);
    return json({ error: "Sorry, that didn't send. Please email alex@schottky.com instead." }, 502);
  }
  return json({ ok: true });
}
