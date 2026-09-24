// Admin session for /admin: one password (ADMIN_PASSWORD), signed cookie
// "sw_admin" = "admin.<expiresMs>.<hmac>". Client tokens are signed over
// "cus_…" payloads, so the two can never be swapped.
import crypto from "node:crypto";
import { json } from "./session.mjs";

const COOKIE = "sw_admin";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error("PORTAL_SESSION_SECRET is not set");
  return s;
}

const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("hex");

export function makeAdminToken() {
  const payload = `admin.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

function readAdminToken(token) {
  const parts = (token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  if (!(Number(parts[1]) > Date.now())) return false;
  const expected = sign(`admin.${parts[1]}`);
  return parts[2].length === expected.length && crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
}

export function isAdmin(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === COOKIE) return readAdminToken(decodeURIComponent(part.slice(i + 1).trim()));
  }
  return false;
}

export function adminCookie(token) {
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  return token ? `${base}; Max-Age=${Math.floor(TTL_MS / 1000)}` : `${base}; Max-Age=0`;
}

export function passwordMatches(given) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Returns a 401/415 Response to send back, or null when the request may proceed.
// Writes must be JSON: a cross-site form can't send that without a CORS preflight.
export function guard(request) {
  if (!isAdmin(request)) return json({ error: "Not signed in" }, 401);
  if (request.method !== "GET" && !(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ error: "Expected JSON" }, 415);
  }
  return null;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
