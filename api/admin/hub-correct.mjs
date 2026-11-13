// "Tell Claude what changed" on a project card in /admin/work. POST { project,
// text } reads the project file and the correction rules (the "Corrections"
// section of the hub's own CLAUDE.md, so the rules live in one place), asks
// Claude for the complete updated file plus a LOG.md line, and returns both with
// the original for the page to show as a diff. Nothing is written here: Apply on
// the page sends the result to api/admin/work.mjs (action "correct"), which
// refuses if the file changed in between.
//
// Env: ANTHROPIC_API_KEY (never sent to the client), optional ANTHROPIC_MODEL
// (default claude-opus-5-5). No SDK: this repo has no npm dependencies, so the
// Messages API is called with fetch. vercel.json gives this function 90 s.
import { guard, readJson } from "../_lib/admin.mjs";
import { hubFile } from "../_lib/hub.mjs";
import { today } from "../_lib/hub-write.mjs";
import { json } from "../_lib/session.mjs";

const MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const TIMEOUT_MS = 75 * 1000;
const MAX_TOKENS = 12000; // a project file is a few hundred lines at most
const NOT_CONNECTED = "Claude isn't connected yet: add ANTHROPIC_API_KEY in Vercel (see scripts/README.md).";

// USD per million tokens, input and output, for the cost shown on the card.
// Cache reads are billed at a tenth of input, cache writes at 1.25x.
const PRICES = {
  "claude-opus-5-5": [4, 20], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25],
  "claude-sonnet-5-5": [2, 10], "claude-sonnet-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-2": [8, 40], "claude-fable-5-1": [10, 50],
};
function cost(model, u) {
  const p = PRICES[model];
  if (!p || !u) return null;
  const usd = ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[0] * 0.1 + (u.cache_creation_input_tokens || 0) * p[0] * 1.25) / 1e6;
  return Math.round(usd * 10000) / 10000;
}

const SCHEMA = {
  type: "object",
  properties: {
    file: { type: "string", description: "The complete updated project file, front matter included, exactly as it should be saved." },
    log: { type: "string", description: "The LOG.md line text only: what changed, one line, no date or project prefix." },
    summary: { type: "string", description: "One or two plain sentences for Alexander: what changed, and the project's Next action now." },
  },
  required: ["file", "log", "summary"],
  additionalProperties: false,
};

// The hub is plain ASCII; Claude usually complies, this catches the rest.
const ASCII = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‒–—―]/g, "-"],
  [/…/g, "..."],
  [/[   ]/g, " "],
  [/•/g, "-"],
];
const ascii = (s) => ASCII.reduce((t, [re, to]) => t.replace(re, to), String(s || ""));

// From "## Corrections: ..." up to the next "## " heading.
function correctionRules(claudeMd) {
  const lines = String(claudeMd || "").replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => /^##\s+Corrections/i.test(l));
  if (at === -1) return "";
  let end = lines.findIndex((l, i) => i > at && /^##\s+/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(at, end).join("\n").trim();
}

function system(rules, date) {
  return [
    "You maintain Alexander Schottky's hub: a git repo of markdown files, one per project, that is his single source of truth.",
    "He has typed a correction for one project on the admin page. Apply it to that project file and return the complete updated file.",
    "",
    "The hub's own rules for corrections, from its CLAUDE.md:",
    "",
    rules || "(The hub's CLAUDE.md has no Corrections section; follow the rules below.)",
    "",
    "What applies here:",
    `- Today is ${date}. Mark each thing he changed with "(per Alexander ${date})" and set last_touched to ${date}.`,
    "- Do exactly what he said and nothing more. Do not reorder or reword lines he did not touch. Do not argue or ask him to justify it.",
    "- Keep exactly one Next action. If his correction finishes or removes the Next action, write the next concrete one from the open tasks.",
    "- Remove any CONFIRM: tag his correction answers. If something in his text is unclear, make the smallest reasonable edit, mark it CONFIRM:, and say what you assumed in the summary.",
    "- Plain ASCII punctuation only, ISO dates (YYYY-MM-DD), tasks as checkboxes with (due YYYY-MM-DD) and (waiting: who) where they apply.",
    "- Never put passwords, account numbers, or ID numbers in the file, even if he typed one; leave it out and say so in the summary.",
    "- Only this file. Do not write NOW.md or LOG.md and do not mention committing: the admin page adds the LOG.md line you return and commits.",
    "- The log text is one line saying what changed, in the hub's style, without a date, project or 'Correction' prefix (for example: back pay settled, removed; added call Rick Monday. Next: send the proposal).",
  ].join("\n");
}

async function ask({ id, file, rules, text }) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw Object.assign(new Error(NOT_CONNECTED), { code: "setup" });
  const date = today();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        // Safety classifiers may decline a request; this re-runs it on Anthropic's recommended fallback model.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: MAX_TOKENS,
        fallbacks: "default",
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        system: system(rules, date),
        messages: [{
          role: "user",
          content: `Project file projects/${id}.md as it stands:\n\n<file>\n${file}\n</file>\n\nCorrection from Alexander, typed ${date}:\n\n${text}`,
        }],
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw Object.assign(new Error("Claude took too long to answer. Try again, or make the correction shorter."), { code: "timeout" });
    throw Object.assign(new Error("Couldn't reach Claude."), { code: "network" });
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.error?.message || `HTTP ${r.status}`;
    console.error("anthropic", r.status, detail);
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Anthropic refused the API key. Check ANTHROPIC_API_KEY in Vercel."), { code: "auth" });
    if (r.status === 429 || r.status === 529) throw Object.assign(new Error("Claude is busy right now. Try again in a minute."), { code: "busy" });
    throw Object.assign(new Error(`Claude returned an error: ${detail}`), { code: "api" });
  }
  if (data.stop_reason === "refusal") throw Object.assign(new Error("Claude declined to make this edit" + (data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : ".")), { code: "refusal" });
  if (data.stop_reason === "max_tokens") throw Object.assign(new Error("Claude's answer was cut off. Try a shorter correction."), { code: "truncated" });
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try { parsed = JSON.parse(out); } catch { throw Object.assign(new Error("Claude's answer wasn't in the expected shape. Try again."), { code: "shape" }); }
  const updated = ascii(parsed.file).replace(/\r/g, "").replace(/\s+$/, "") + "\n";
  if (!/^---\n[\s\S]*?\n---\n/.test(updated) || !/^## Next action\s*$/m.test(updated)) {
    throw Object.assign(new Error("Claude's file lost its front matter or Next action. Try again."), { code: "shape" });
  }
  return {
    project: id,
    original: file,
    file: updated,
    log: ascii(parsed.log).replace(/\s+/g, " ").trim(),
    summary: ascii(parsed.summary).trim(),
    model: data.model || MODEL(),
    usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : null,
    cost: cost(data.model || MODEL(), data.usage),
    ms: Date.now() - started,
    date,
  };
}

export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await readJson(request);
  const id = String(body.project || "");
  const text = String(body.text || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) return json({ error: "Unknown project." }, 400);
  if (!text) return json({ error: "Say what changed first." }, 400);
  if (text.length > 4000) return json({ error: "That's a lot for one correction. Split it up." }, 400);

  let file, rules;
  try {
    [file, rules] = await Promise.all([hubFile(`projects/${id}.md`), hubFile("CLAUDE.md").then(correctionRules).catch(() => "")]);
  } catch (err) {
    console.error("hub read failed", id, err.message);
    if (/HUB_GITHUB_TOKEN/.test(err.message)) return json({ error: "The hub isn't connected yet: add HUB_GITHUB_TOKEN in Vercel (see scripts/README.md)." }, 503);
    if (err.status === 404) return json({ error: "That project file isn't in the hub any more. Refresh." }, 404);
    return json({ error: `Couldn't read the hub: ${err.message}` }, 502);
  }
  try {
    return json(await ask({ id, file: file.replace(/\r/g, ""), rules, text }));
  } catch (err) {
    if (err.code === "setup") return json({ error: err.message }, 503);
    if (err.code === "timeout") return json({ error: err.message }, 504);
    console.error("claude correction failed", id, err.code, err.message);
    return json({ error: err.message }, 502);
  }
}
