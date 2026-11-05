// Seals a password for /admin/sites with the public key alone, so a value can
// go into api/_lib/sites-seed.mjs without the private key ever leaving Vercel.
// Same format as seal() in api/_lib/sites.mjs. Reads the value from stdin:
//   printf '%s' "$VALUE" | node scripts/seal.mjs
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const publicKey = readFileSync(new URL("./sites-public.pem", import.meta.url), "utf8");
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const text = Buffer.concat(chunks).toString("utf8");
if (!text) throw new Error("Nothing on stdin");

const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
const wrapped = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
process.stdout.write(["v1", wrapped, iv, cipher.getAuthTag(), ct].map((b) => (typeof b === "string" ? b : b.toString("base64url"))).join("."));
