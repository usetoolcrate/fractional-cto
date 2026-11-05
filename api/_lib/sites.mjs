// The site list behind /admin/sites: every site I've built, with its links,
// client, details and passwords. The repo is public, so none of it lives here:
// the list is one JSON file in a private Vercel Blob store, and each password
// is sealed with SITES_PRIVATE_KEY's public half (RSA-OAEP wraps a one-off
// AES-256-GCM key), so the file alone, or the Blob browser, shows no passwords.
// The REST calls are the same ones the eBay Lister (toolcrate/apps/ebay-lister)
// uses, so there are still no npm dependencies.
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const API = "https://vercel.com/api/blob";
const token = () => (process.env.BLOB_READ_WRITE_TOKEN || "").trim();
const storeId = () => token().split("_")[3] || "";
// Previews and local runs get their own file, so testing never touches the real list.
const pathname = () => `sites/${process.env.VERCEL_ENV || "development"}.json`;

export const GROUPS = ["client", "business", "app", "property"];
export const STATUSES = ["live", "building", "paused", "retired"];

async function readStore() {
  if (process.env.SITES_FILE) {
    try {
      return JSON.parse(await readFile(process.env.SITES_FILE, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
  const res = await fetch(`https://${storeId()}.private.blob.vercel-storage.com/${pathname()}?cache=0`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Reading the site list failed (HTTP ${res.status})`);
  return res.json();
}

async function writeStore(registry) {
  const body = JSON.stringify(registry);
  if (process.env.SITES_FILE) return writeFile(process.env.SITES_FILE, body);
  const res = await fetch(`${API}/?${new URLSearchParams({ pathname: pathname() })}`, {
    method: "PUT",
    body,
    headers: {
      authorization: `Bearer ${token()}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": storeId(),
      "x-vercel-blob-access": "private",
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": "60",
    },
  });
  if (!res.ok) throw new Error(`Saving the site list failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/* ---------- sealing ---------- */

function privateKey() {
  const b64 = process.env.SITES_PRIVATE_KEY;
  if (!b64) throw new Error("SITES_PRIVATE_KEY is not set");
  return crypto.createPrivateKey(Buffer.from(b64, "base64").toString("utf8"));
}
const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

// "v1.<wrapped key>.<iv>.<tag>.<ciphertext>", all base64url. scripts/seal.mjs
// makes the same thing from the public key alone.
export function seal(text) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const wrapped = crypto.publicEncrypt({ key: crypto.createPublicKey(privateKey()), ...OAEP }, key);
  return ["v1", wrapped, iv, cipher.getAuthTag(), ct].map((b) => (typeof b === "string" ? b : b.toString("base64url"))).join(".");
}

export function unseal(sealed) {
  const [v, wrapped, iv, tag, ct] = String(sealed).split(".");
  if (v !== "v1" || !ct) throw new Error("Not a sealed value");
  const key = crypto.privateDecrypt({ key: privateKey(), ...OAEP }, Buffer.from(wrapped, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/* ---------- the list ---------- */

export const newId = () => crypto.randomBytes(6).toString("base64url");
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const url = (v) => {
  const s = str(v, 300);
  return /^https?:\/\/[^\s"'<>]+$/.test(s) ? s : "";
};

// Everything but the secrets, cleaned up. Used for saves and for seed entries.
export function cleanSite(s) {
  return {
    id: /^[A-Za-z0-9_-]{4,40}$/.test(s.id || "") ? s.id : newId(),
    name: str(s.name, 120),
    group: GROUPS.includes(s.group) ? s.group : "client",
    status: STATUSES.includes(s.status) ? s.status : "live",
    url: url(s.url),
    admin: url(s.admin),
    client: str(s.client, 300),
    launched: /^\d{4}-\d{2}-\d{2}$/.test(s.launched || "") ? s.launched : "",
    notes: str(s.notes, 4000),
    details: (Array.isArray(s.details) ? s.details : [])
      .map((d) => ({ k: str(d?.k, 60), v: str(d?.v, 1000) }))
      .filter((d) => d.k || d.v)
      .slice(0, 40),
  };
}

// New sites from api/_lib/sites-seed.mjs are added once, by id, so a site I
// delete in the admin stays deleted. The seed file is kept out of git (the
// repo is public) but goes up with each deploy.
async function withSeed(registry) {
  let seed = [];
  try {
    ({ SEED: seed } = await import("./sites-seed.mjs"));
  } catch {
    return false;
  }
  let changed = false;
  for (const s of seed) {
    if (registry.seeded.includes(s.id)) continue;
    registry.seeded.push(s.id);
    if (!registry.sites.some((x) => x.id === s.id)) {
      const secrets = (s.secrets || []).map((x) => ({ id: newId(), label: str(x.label, 60), sealed: x.sealed || null }));
      registry.sites.push({ ...cleanSite(s), secrets, updated: Date.now() });
    }
    changed = true;
  }
  return changed;
}

export async function loadRegistry() {
  const registry = (await readStore()) || { v: 1, seeded: [], sites: [] };
  if (await withSeed(registry)) await writeStore(registry);
  return registry;
}

export const saveRegistry = writeStore;
