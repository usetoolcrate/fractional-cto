// Minimal Stripe REST client — no SDK, so the site keeps zero npm dependencies.
// Pinned API version: response shapes below (current_period_end on subscription
// items, invoices/create_preview) assume this version.
//
// Two keys: STRIPE_SECRET_KEY (restricted, mostly read — the client portal) and
// STRIPE_ADMIN_KEY (full key, only used by /api/admin/* behind the admin login).

export const STRIPE_VERSION = "2026-04-22.dahlia";

// Stripe's form encoding: nested objects as a[b][c], arrays as a[0][b].
function encode(value, prefix, out) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => encode(v, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) encode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

export async function stripe(method, path, params, { admin = false, idempotencyKey } = {}) {
  const key = admin ? process.env.STRIPE_ADMIN_KEY : process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error(`${admin ? "STRIPE_ADMIN_KEY" : "STRIPE_SECRET_KEY"} is not set`);
  const query = params ? encode(params, "", []).join("&") : "";
  let url = `https://api.stripe.com/v1/${path}`;
  const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let body;
  if (method === "GET" || method === "DELETE") {
    if (query) url += (url.includes("?") ? "&" : "?") + query;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = query;
  }
  const res = await fetch(url, { method, headers, body });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

// Same client, bound to the admin key.
export function adminStripe(method, path, params, opts = {}) {
  return stripe(method, path, params, { ...opts, admin: true });
}

export function isTestMode() {
  return (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_ADMIN_KEY || "").includes("_test_");
}

export function dashboardUrl(path) {
  return `https://dashboard.stripe.com/${isTestMode() ? "test/" : ""}${path}`;
}
