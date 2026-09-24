// Signed, stateless client session. Same idea as the Wild Foods admin cookie
// (wildfoods-by-dyllan/api/_lib/auth.ts), but the token carries which Stripe
// customer signed in: "<customerId>.<expiresMs>.<hmac>".
import crypto from "node:crypto";

const COOKIE = "sw_pay";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error("PORTAL_SESSION_SECRET is not set");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function makeToken(customerId) {
  const payload = `${customerId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [customerId, expires, sig] = parts;
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) return null;
  if (!(Number(expires) > Date.now())) return null;
  const expected = sign(`${customerId}.${expires}`);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? customerId : null;
}

export function customerFromRequest(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === COOKIE) {
      return readToken(decodeURIComponent(part.slice(i + 1).trim()));
    }
  }
  return null;
}

export function sessionCookie(token) {
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return token ? `${base}; Max-Age=${Math.floor(TTL_MS / 1000)}` : `${base}; Max-Age=0`;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
