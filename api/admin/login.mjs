import { adminCookie, makeAdminToken, passwordMatches, readJson } from "../_lib/admin.mjs";
import { json } from "../_lib/session.mjs";

export async function POST(request) {
  const body = await readJson(request);
  if (!passwordMatches(body.password)) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Wrong password." }, 401);
  }
  return json({ ok: true }, 200, { "Set-Cookie": adminCookie(makeAdminToken()) });
}
