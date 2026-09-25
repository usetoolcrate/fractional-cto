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

function rawToken(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function customerFromRequest(request) {
  return readToken(rawToken(request));
}

// Unix seconds when this browser signed in (tokens carry only their expiry).
export function sessionIssuedAt(request) {
  const expires = Number((rawToken(request) || "").split(".")[1]);
  return Number.isFinite(expires) ? Math.floor((expires - TTL_MS) / 1000) : 0;
}

// Issuing a new code signs out every browser that signed in before it.
export function sessionRevoked(request, customer) {
  const issued = Number(customer?.metadata?.code_issued_at) || 0;
  return issued > 0 && sessionIssuedAt(request) < issued;
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

export async function readSessionId(request) {
  try {
    const body = await request.json();
    const id = String(body?.session ?? "");
    return /^cs_(test|live)_[A-Za-z0-9]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// One-time email sign-in links: "link.<customerId>.<nonce>.<expiresMs>.<hmac>".
// The nonce must still match the customer's metadata (login_link_nonce), which
// is cleared on use and replaced by each new request, so a link works once.
const LINK_TTL_MS = 1000 * 60 * 30; // 30 minutes

export function makeLinkToken(customerId, nonce) {
  const payload = `link.${customerId}.${nonce}.${Date.now() + LINK_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function readLinkToken(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 5 || parts[0] !== "link") return null;
  const [, customerId, nonce, expires, sig] = parts;
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId) || !/^[a-f0-9]{16,64}$/.test(nonce)) return null;
  if (!(Number(expires) > Date.now())) return null;
  const expected = sign(`link.${customerId}.${nonce}.${expires}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { customerId, nonce };
}
