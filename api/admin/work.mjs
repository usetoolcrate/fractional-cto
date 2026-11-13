// The Work view for /admin/work: what is in flight, what is next, and what got
// done, read from the task hub repo (see api/_lib/hub.mjs). Read-only.
// GET returns the parsed hub; GET ?fresh=1 skips the one-minute cache.
import { guard } from "../_lib/admin.mjs";
import { loadHub } from "../_lib/hub.mjs";
import { json } from "../_lib/session.mjs";

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.get("fresh");
  try {
    return json(await loadHub({ fresh: Boolean(fresh) }));
  } catch (err) {
    console.error("hub load failed", err.message);
    const setup = /HUB_GITHUB_TOKEN/.test(err.message);
    return json(
      { error: setup ? "The hub isn't connected yet: add HUB_GITHUB_TOKEN in Vercel (see scripts/README.md)." : `Couldn't load the hub: ${err.message}` },
      setup ? 503 : 502,
    );
  }
}
