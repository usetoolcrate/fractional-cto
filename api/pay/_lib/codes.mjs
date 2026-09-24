// Client access codes, e.g. "WFD-7K3MQ-9P2XA". Only a SHA-256 hash is stored,
// in the Stripe customer's metadata (portal_code_sha256) — Stripe is the only
// database. Codes are matched case-insensitively and ignore spaces/dashes.
import crypto from "node:crypto";

// Crockford-style alphabet: no I, L, O, U, so codes read aloud without confusion.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCode(code) {
  return crypto.createHash("sha256").update(normalizeCode(code)).digest("hex");
}

// 10 random characters = 50 bits, plus an optional readable client prefix.
export function generateCode(prefix = "") {
  const bytes = crypto.randomBytes(10);
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
  const body = `${chars.slice(0, 5)}-${chars.slice(5)}`;
  const p = normalizeCode(prefix).slice(0, 4);
  return p ? `${p}-${body}` : body;
}
