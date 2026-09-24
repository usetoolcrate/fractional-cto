import { adminCookie } from "../_lib/admin.mjs";
import { json } from "../_lib/session.mjs";

export async function POST() {
  return json({ ok: true }, 200, { "Set-Cookie": adminCookie(null) });
}
