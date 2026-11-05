// The site list for /admin/sites (see api/_lib/sites.mjs). GET lists every
// site with its passwords' labels only; GET ?stats=1 (or =fresh to skip the
// cache) returns their Analytics and Search Console numbers (stats.mjs);
// POST { action, … } acts on the list.
// Actions: reveal (one password, decrypted), save (add or update a site; a
// password left blank keeps its saved value), delete.
import { guard, readJson } from "../_lib/admin.mjs";
import { json } from "../_lib/session.mjs";
import { GROUPS, cleanSite, loadRegistry, newId, saveRegistry, seal, unseal } from "../_lib/sites.mjs";
import { getStats } from "../_lib/stats.mjs";

const visible = (s) => ({ ...s, secrets: s.secrets.map(({ sealed, ...x }) => ({ ...x, saved: Boolean(sealed) })) });
// By kind; within a kind, in the order they were added (the main clients first).
const order = (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const stats = new URL(request.url).searchParams.get("stats");
  try {
    const { sites } = await loadRegistry();
    if (stats) {
      // Vercel's OIDC token for this request proves to Google it's this project (google.mjs).
      const oidc = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;
      return json(await getStats(sites, oidc, { fresh: stats === "fresh" }));
    }
    return json({ sites: sites.slice().sort(order).map(visible) });
  } catch (err) {
    console.error(stats ? "site stats failed" : "sites list failed", err.message);
    return json({ error: stats ? `Couldn't load the stats: ${err.message}` : "Couldn't load the site list." }, 500);
  }
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  try {
    const registry = await loadRegistry();
    const site = registry.sites.find((s) => s.id === (body.action === "save" ? body.site?.id : body.id));

    if (body.action === "reveal") {
      const secret = site?.secrets.find((x) => x.id === body.secret);
      if (!secret?.sealed) return json({ error: "Nothing saved there." }, 404);
      try {
        return json({ value: unseal(secret.sealed) });
      } catch (err) {
        console.error("unseal failed", err.message);
        return json({ error: "Couldn't unlock this one. Save it again." }, 500);
      }
    }

    if (body.action === "delete") {
      if (!site) return json({ error: "That site is already gone." }, 404);
      registry.sites = registry.sites.filter((s) => s !== site);
      await saveRegistry(registry);
      return json({ ok: true });
    }

    if (body.action === "save") {
      const next = cleanSite(body.site || {});
      if (!next.name) return json({ error: "Give the site a name." }, 400);
      const old = new Map((site?.secrets || []).map((x) => [x.id, x]));
      next.secrets = (Array.isArray(body.site.secrets) ? body.site.secrets : []).slice(0, 20).map((x) => {
        const kept = old.get(x?.id);
        const value = typeof x?.value === "string" ? x.value.slice(0, 2000) : "";
        return {
          id: kept ? kept.id : newId(),
          label: String(x?.label ?? "").trim().slice(0, 60) || "Password",
          sealed: value ? seal(value) : x?.clear ? null : kept?.sealed || null,
        };
      });
      next.updated = Date.now();
      if (site) Object.assign(site, next);
      else registry.sites.push(next);
      await saveRegistry(registry);
      return json({ site: visible(next) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("sites action failed", body.action, err.message);
    return json({ error: "Couldn't save that. Try again." }, 500);
  }
}
