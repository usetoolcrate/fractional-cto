import { loadAccount } from "../_lib/account.mjs";
import { reconcilePending } from "../_lib/plans.mjs";
import { guard, readJson } from "../_lib/admin.mjs";
import { json } from "../_lib/session.mjs";
import { adminStripe, isTestMode } from "../_lib/stripe.mjs";

// GET: every portal client with a one-line billing summary.
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const found = await adminStripe("GET", "customers/search", { query: "metadata['portal']:'schottky'", limit: 100 });
    const clients = await Promise.all(
      found.data.map(async (c) => {
        let a = await loadAccount(c.id, { admin: true });
        if (a?.needsReconcile) {
          await reconcilePending(c.id, a.customer);
          a = await loadAccount(c.id, { admin: true });
        }
        const open = a?.invoices.filter((i) => i.status === "open" && !i.processing) ?? [];
        return {
          id: c.id,
          name: c.name || c.email,
          email: c.email,
          plan: a?.plan ?? [],
          pending: a?.pending ? { due: a.pending.due, first: a.pending.first, phases: a.pending.phases.map((p) => ({ amount: p.amount, months: p.months })) } : null,
          nextCharge: a?.nextCharge ?? null,
          autopay: a?.autopay ?? null,
          owed: open.reduce((s, i) => s + i.remaining, 0),
          failed: open.some((i) => i.attempted),
          codeIssued: Boolean(c.metadata?.portal_code_sha256),
          inviteSentAt: Number(c.metadata?.invite_sent_at) || null,
        };
      }),
    );
    clients.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return json({ testMode: isTestMode(), clients });
  } catch (err) {
    console.error("clients list failed", err.message);
    return json({ error: "Couldn't load clients from Stripe." }, 500);
  }
}

// POST: create a client (or return the existing portal client with that email).
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!name) return json({ error: "Enter the client's name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const prefix = String(body.prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

  try {
    // Exact email list (not search) so a client created seconds ago is found.
    const existing = await adminStripe("GET", "customers", { email, limit: 10 });
    const match = existing.data.find((c) => c.metadata?.portal === "schottky");
    if (match) return json({ id: match.id, existed: true });
    const customer = await adminStripe(
      "POST",
      "customers",
      { name, email, metadata: { portal: "schottky", portal_prefix: prefix } },
      { idempotencyKey: body.requestId ? `client-${body.requestId}` : undefined },
    );
    return json({ id: customer.id, existed: false }, 201);
  } catch (err) {
    console.error("client create failed", err.message);
    return json({ error: `Stripe said: ${err.message}` }, 500);
  }
}
