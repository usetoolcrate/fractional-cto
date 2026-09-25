// Transactional email through Resend's REST API (no SDK). Sends as EMAIL_FROM,
// default "Alexander Schottky <alex@schottky.com>"; replies go to the same inbox.
//
// Every client email also sends me a separate copy (EMAIL_BCC, default
// alex@schottky.com) so I keep a record of exactly what each client was sent.
// It's a separate message from EMAIL_COPY_FROM (portal@schottky.com), not a
// real BCC: a BCC arrives "from me, to me", and Gmail files that under
// Sent/All Mail instead of the inbox. Set EMAIL_BCC to "" to stop copies;
// pass bcc: false for mail that shouldn't be copied (one-time sign-in links).

const SITE = "https://schottky.com";

async function resend(payload, idempotencyKey) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Email failed (${res.status})`);
  return data.id;
}

export async function sendEmail({ to, subject, text, html, idempotencyKey, bcc: copyMe = true }) {
  const from = process.env.EMAIL_FROM || "Alexander Schottky <alex@schottky.com>";
  const id = await resend(
    { from, to: [to], subject, text, html, reply_to: process.env.EMAIL_REPLY_TO || "alex@schottky.com" },
    idempotencyKey,
  );

  const copy = copyMe ? (process.env.EMAIL_BCC ?? "alex@schottky.com").trim() : "";
  if (!copy || copy.toLowerCase() === String(to).toLowerCase()) return { id, copiedTo: null };
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const note = `Copy of the email sent to ${to} on ${when} (Central).`;
  try {
    await resend(
      {
        from: process.env.EMAIL_COPY_FROM || "Schottky client portal <portal@schottky.com>",
        to: [copy],
        reply_to: to, // replying to the copy writes to the client
        subject: `Copy: ${subject} (sent to ${to})`,
        text: `${note}\n\n----------\n\n${text}`,
        html: String(html).replace(
          /(<body[^>]*>)/i,
          `$1<div style="max-width:560px;margin:0 auto 12px;padding:10px 14px;background:#f1ede5;border-radius:6px;font-size:13px;color:#4a4f56">${esc(note)}</div>`,
        ),
      },
      idempotencyKey ? `${idempotencyKey}-copy` : undefined,
    );
    return { id, copiedTo: copy };
  } catch (err) {
    // The client's email already went out; a failed copy shouldn't undo that.
    console.error("copy email failed", err.message);
    return { id, copiedTo: null };
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const dueDay = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
};
const day = (sec) =>
  new Date(sec * 1000).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });

// Blank-line-separated prose -> paragraphs, so an edited body keeps its shape.
const paragraphs = (s) =>
  String(s)
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

// Written in the first person: it comes from my own address. `body` replaces the
// suggested message; the greeting, link, code box and footer stay put so an
// edited invite can never go out without the code or the sign-in link.
export function inviteEmail({ name, code, nextCharge, hasAutopay, pending, body }) {
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

  const suggested = [charge, ask].filter(Boolean).join(" ");
  const message = typeof body === "string" && body.trim() ? body.trim() : suggested;

  const text = [
    `Hi ${first},`,
    "",
    "I've set up a page where you can see your plan and invoices and manage autopay:",
    url,
    "",
    `Your client code: ${code}`,
    "",
    message,
    "",
    "If you ever lose the code, use the email option on that page and I'll email you a one-time sign-in link.",
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
${paragraphs(message)}
<p style="margin:0 0 16px;color:#4a4f56;font-size:14px">If you ever lose the code, use the email option on that page and I'll email you a one-time sign-in link.</p>
<p style="margin:0">Questions? Just reply to this email.</p>
</div></body></html>`;

  return { subject: "Your billing page and client code", text, html, body: message, suggested };
}

// One-time sign-in link for /payments (no code needed). Not copied to me.
export function signInEmail({ name, url }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${first},`,
    "",
    "Here's your link to sign in to your billing page. It works once and expires in 30 minutes:",
    url,
    "",
    "If you didn't ask for this, you can ignore this email; nothing changes.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#1c1e21;font-size:16px;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2dcd0;border-radius:10px;padding:28px">
<p style="margin:0 0 16px">Hi ${esc(first)},</p>
<p style="margin:0 0 20px">Here's your link to sign in to your billing page. It works once and expires in 30 minutes.</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:#1f5c48;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">Sign in to schottky.com/payments</a></p>
<p style="margin:0;color:#4a4f56;font-size:14px">If you didn't ask for this, you can ignore this email; nothing changes.</p>
</div></body></html>`;
  return { subject: "Your sign-in link for schottky.com/payments", text, html };
}
