// Numbers for /admin/sites. For each site with an Analytics property: visitors,
// visits, page views, leads and sales over the last 28 days and the 28 before,
// its top pages, and who's on it right now. For each site in Search Console:
// Google search clicks, impressions, average position and the top searches.
// Read with the read-only service account (google.mjs) and cached for three
// hours in the Blob store, so the page is quick and Google isn't asked on
// every visit.
import { googleApi, googleToken } from "./google.mjs";
import { readStore, writeStore } from "./sites.mjs";

const TTL_MS = 3 * 60 * 60 * 1000;
// Counted as leads: forms sent and taps on phone, text and email links (see each site's tag).
const LEADS = ["generate_lead", "phone_click", "email_click", "text_click"];
const GA = (property, method) => `https://analyticsdata.googleapis.com/v1beta/properties/${property}:${method}`;
const RANGES = [
  { startDate: "28daysAgo", endDate: "today", name: "now" },
  { startDate: "56daysAgo", endDate: "29daysAgo", name: "before" },
];

const num = (v) => Number(v ?? 0) || 0;
const day = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

// With two date ranges, Analytics adds the range name as the last dimension of each row.
function byRange(report, read) {
  const out = { now: read([]), before: read([]) };
  for (const row of report.rows || []) {
    const dims = row.dimensionValues.map((d) => d.value);
    const range = dims.pop();
    if (range in out) out[range] = read(row.metricValues.map((m) => num(m.value)), dims, out[range]);
  }
  return out;
}

async function analytics(token, site) {
  const path = site.analyticsPath
    ? { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: site.analyticsPath } } }
    : null;
  const events = { filter: { fieldName: "eventName", inListFilter: { values: [...LEADS, "purchase"] } } };
  const run = (body) => googleApi(token, GA(site.analytics, "runReport"), body);
  const [totals, counts, pages, live] = await Promise.all([
    run({
      dateRanges: RANGES,
      metrics: ["activeUsers", "sessions", "screenPageViews", "purchaseRevenue"].map((name) => ({ name })),
      ...(path && { dimensionFilter: path }),
    }),
    run({
      dateRanges: RANGES,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: path ? { andGroup: { expressions: [events, path] } } : events,
    }),
    run({
      dateRanges: [RANGES[0]],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5,
      ...(path && { dimensionFilter: path }),
    }),
    // Real-time can't be narrowed to a path, so a shared property shows no "now".
    path ? null : googleApi(token, GA(site.analytics, "runRealtimeReport"), { metrics: [{ name: "activeUsers" }] }),
  ]);
  const t = byRange(totals, ([users = 0, sessions = 0, views = 0, revenue = 0]) => ({ users, sessions, views, revenue }));
  const e = byRange(counts, ([count = 0], [name] = [], acc = { leads: 0, sales: 0, events: {} }) => {
    if (!name) return acc;
    acc.events[name] = count;
    if (LEADS.includes(name)) acc.leads += count;
    if (name === "purchase") acc.sales += count;
    return acc;
  });
  return {
    now: { ...t.now, ...e.now },
    before: { ...t.before, ...e.before },
    pages: (pages.rows || []).map((r) => ({ path: r.dimensionValues[0].value, views: num(r.metricValues[0].value) })),
    live: live ? num(live.rows?.[0]?.metricValues?.[0]?.value) : null,
  };
}

async function search(token, site) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.searchConsole)}/searchAnalytics/query`;
  // Search data runs about three days behind, so both spans end three days back.
  const now = { startDate: day(30), endDate: day(3) };
  const before = { startDate: day(58), endDate: day(31) };
  const [a, b, q] = await Promise.all([
    googleApi(token, url, now),
    googleApi(token, url, before),
    googleApi(token, url, { ...now, dimensions: ["query"], rowLimit: 5 }),
  ]);
  const total = (r) => ({ clicks: num(r.rows?.[0]?.clicks), impressions: num(r.rows?.[0]?.impressions), position: r.rows?.[0]?.position ?? null });
  return {
    now: total(a),
    before: total(b),
    queries: (q.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
  };
}

async function siteStats(token, site) {
  const out = {};
  const [ga, sc] = await Promise.allSettled([
    site.analytics ? analytics(token, site) : null,
    site.searchConsole ? search(token, site) : null,
  ]);
  if (ga.status === "fulfilled" && ga.value) out.ga = ga.value;
  if (sc.status === "fulfilled" && sc.value) out.search = sc.value;
  const errors = [ga, sc].filter((r) => r.status === "rejected").map((r) => r.reason.message);
  if (errors.length) out.error = errors.join("; ").slice(0, 300);
  return out;
}

// What the cache was built for: a site added or re-pointed refreshes it.
const signature = (sites) =>
  sites.map((s) => `${s.id}:${s.analytics}:${s.analyticsPath}:${s.searchConsole}`).sort().join("|");

export async function getStats(sites, oidcToken, { fresh = false } = {}) {
  const tracked = sites.filter((s) => s.analytics || s.searchConsole);
  const sig = signature(tracked);
  const cached = await readStore("stats").catch(() => null);
  if (!fresh && cached && cached.sig === sig && Date.now() - cached.at < TTL_MS) return cached;
  const token = await googleToken(oidcToken);
  const entries = await Promise.all(tracked.map(async (s) => [s.id, await siteStats(token, s)]));
  const stats = { at: Date.now(), sig, sites: Object.fromEntries(entries) };
  await writeStore(stats, "stats").catch((err) => console.error("stats cache write failed", err.message));
  return stats;
}
