// Client access codes, e.g. "7K3MQ9". Only a SHA-256 hash is stored,
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

// Six characters short enough to read out over the phone. 32^6 is about 1.07
// billion codes; 256 divides evenly by 32, so the modulo below is unbiased.
export const CODE_LENGTH = 6;

export function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}
