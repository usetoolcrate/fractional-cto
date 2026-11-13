// The Work view for /admin/work: what is in flight, what is next, and what got
// done, read from the task hub repo (see api/_lib/hub.mjs).
// GET returns the parsed hub; GET ?fresh=1 skips the one-minute cache.
// POST { action, … } ticks something off and commits it to the hub
// (api/_lib/hub-write.mjs), then returns the hub as it now stands.
// Actions: done-current { expect }, done-queue { index, text },
// task { project, text, done } (project empty = a checklist in NOW.md).
import { guard, readJson } from "../_lib/admin.mjs";
import { commitFiles, loadHub } from "../_lib/hub.mjs";
import { Stale, doneCurrent, doneQueue, setTask } from "../_lib/hub-write.mjs";
import { json } from "../_lib/session.mjs";

const setup = (err) => /HUB_GITHUB_TOKEN/.test(err.message);
const NOT_CONNECTED = "The hub isn't connected yet: add HUB_GITHUB_TOKEN in Vercel (see scripts/README.md).";

export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.get("fresh");
  try {
    return json(await loadHub({ fresh: Boolean(fresh) }));
  } catch (err) {
    console.error("hub load failed", err.message);
    return json({ error: setup(err) ? NOT_CONNECTED : `Couldn't load the hub: ${err.message}` }, setup(err) ? 503 : 502);
  }
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  try {
    let edit;
    if (body.action === "done-current") edit = doneCurrent(body);
    else if (body.action === "done-queue") edit = doneQueue(body);
    else if (body.action === "task") edit = setTask(body);
    else return json({ error: "Unknown action" }, 400);
    const sha = await commitFiles(edit);
    return json({ ...(await loadHub({ fresh: true })), saved: sha.slice(0, 7) });
  } catch (err) {
    if (err instanceof Stale) return json({ error: err.message }, 409);
    console.error("hub edit failed", body.action, err.message);
    if (setup(err)) return json({ error: NOT_CONNECTED }, 503);
    // A read-only token can load the page but GitHub refuses its writes.
    if (err.status === 403 || err.status === 404) {
      return json({ error: "The hub token can't write yet: give it Contents \"Read and write\" on the hub repo (see scripts/README.md)." }, 502);
    }
    return json({ error: `Couldn't save that: ${err.message}` }, 502);
  }
}
