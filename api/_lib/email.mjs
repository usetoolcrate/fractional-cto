// Transactional email through Resend's REST API (no SDK). Sends as EMAIL_FROM,
// default "Alexander Schottky <alex@schottky.com>"; replies go to the same inbox.

const SITE = "https://schottky.com";

export async function sendEmail({ to, subject, text, html, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const from = process.env.EMAIL_FROM || "Alexander Schottky <alex@schottky.com>";
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({ from, to: [to], subject, text, html, reply_to: process.env.EMAIL_REPLY_TO || "alex@schottky.com" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Email failed (${res.status})`);
  return data.id;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const dueDay = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
};
const day = (sec) =>
  new Date(sec * 1000).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });

// Written in the first person: it comes from my own address.
export function inviteEmail({ name, code, nextCharge, hasAutopay, pending }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const url = `${SITE}/payments`;
  const charge = pending
    ? `Your first payment of ${money(pending.first)} is due by ${dueDay(pending.due)}. Your plan starts the day you pay, and after that each month's charge happens automatically.`
    : nextCharge
      ? `Your next charge is ${money(nextCharge.amount)} on ${day(nextCharge.date)}.`
      : "";
  const ask = pending
    ? "Sign in and choose Pay and start my plan. You can pay from your bank account or with a card; a bank account keeps fees down, but either works."
    : hasAutopay
    ? "Autopay is already set up, so there's nothing you need to do. You can sign in any time to see invoices or change your payment method."
    : "Please sign in and choose Set up autopay to connect your bank account or a card. A bank account keeps fees down, but either works. After that, each month's charge happens on its own and you get a receipt by email.";

  const text = [
    `Hi ${first},`,
    "",
    "I've set up a page where you can see your plan and invoices and manage autopay:",
    url,
    "",
    `Your client code: ${code}`,
    "",
    [charge, ask].filter(Boolean).join(" "),
    "",
    "If you ever lose the code, use the email option on that page and my payment processor, Stripe, will email you a sign-in link.",
    "",
    "Questions? Just reply to this email.",
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#1c1e21;font-size:16px;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2dcd0;border-radius:10px;padding:28px">
<p style="margin:0 0 16px">Hi ${esc(first)},</p>
<p style="margin:0 0 16px">I've set up a page where you can see your plan and invoices and manage autopay.</p>
<p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:#1f5c48;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">Open schottky.com/payments</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#4a4f56">Your client code</p>
<p style="margin:0 0 20px;font-family:ui-monospace,Menlo,monospace;font-size:20px;letter-spacing:.08em;background:#f1ede5;border-radius:6px;padding:10px 14px;display:inline-block">${esc(code)}</p>
<p style="margin:0 0 16px">${esc([charge, ask].filter(Boolean).join(" "))}</p>
<p style="margin:0 0 16px;color:#4a4f56;font-size:14px">If you ever lose the code, use the email option on that page and my payment processor, Stripe, will email you a sign-in link.</p>
<p style="margin:0">Questions? Just reply to this email.</p>
</div></body></html>`;

  return { subject: "Your billing page and client code", text, html };
}
