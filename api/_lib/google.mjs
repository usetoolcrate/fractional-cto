// Google API access for the stats on /admin/sites, with no stored key.
// Vercel signs an OIDC token for each request to this project; Google's
// Workload Identity Federation (pool "vercel", provider "fractional-cto" in the
// Cloud project schottky-site-stats, which only accepts this project's tokens)
// trades it for a short-lived token of the read-only service account below.
// That account is a Viewer on each site's Analytics property and a restricted
// user in Search Console, nothing more.
const AUDIENCE =
  "//iam.googleapis.com/projects/682707364695/locations/global/workloadIdentityPools/vercel/providers/fractional-cto";
export const SERVICE_ACCOUNT = "site-stats@schottky-site-stats.iam.gserviceaccount.com";
const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

let cached = null; // { token, expires } — reused while the function instance is warm

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${data.error_description || data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// oidcToken: the request's x-vercel-oidc-token header (or VERCEL_OIDC_TOKEN locally).
export async function googleToken(oidcToken) {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  if (!oidcToken) throw new Error("No Vercel OIDC token on this request");
  const sts = await post("https://sts.googleapis.com/v1/token", {
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: AUDIENCE,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    subjectToken: oidcToken,
  });
  const sa = await post(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:generateAccessToken`,
    { scope: SCOPES, lifetime: "3600s" },
    { Authorization: `Bearer ${sts.access_token}` },
  );
  cached = { token: sa.accessToken, expires: Date.parse(sa.expireTime) };
  return cached.token;
}

export async function googleApi(token, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
