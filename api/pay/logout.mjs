import { json, sessionCookie } from "../_lib/session.mjs";

export async function POST() {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
