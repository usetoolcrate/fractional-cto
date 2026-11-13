// The few edits /admin/work can make to the task hub: finish the current task
// (the next one in the queue takes its place), finish a queue item, tick or
// untick a task in NOW.md or a project file, and apply a correction to a
// project file that Claude drafted (api/admin/hub-correct.mjs). Each edit also
// adds a line to LOG.md, marked "(via admin)" so a hub session knows to fold it
// into NOW.md. Pure text in, text out: hub.mjs does the commit.
//
// Every edit names the text it expects to find. If the hub moved on since the
// page loaded, the edit refuses instead of ticking the wrong thing.

export class Stale extends Error {}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 3).trimEnd() + "..." : s);
// For a log line or commit subject: no markdown, no file pointer, no table pipes.
const plain = (s) => norm(String(s).replace(/\s*->\s*`?projects\/[\w./-]+`?\s*/g, " ").replace(/\*\*|`/g, "").replace(/\|/g, "/"));
const projectOf = (s) => /projects\/([a-z0-9-]+)\.md/.exec(s)?.[1] || "hub";

// The hub runs on Alexander's clock, whatever the server's is.
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// [first line after the "## heading", first line of the next section)
function range(lines, re) {
  const at = lines.findIndex((l) => /^##\s+/.test(l) && re.test(l.replace(/^##\s+/, "")));
  if (at === -1) return null;
  let end = lines.findIndex((l, i) => i > at && /^##\s+/.test(l));
  if (end === -1) end = lines.length;
  return [at + 1, end];
}

// List items in [from, to), each with the wrapped lines that belong to it.
function items(lines, from, to, marker) {
  const out = [];
  for (let i = from; i < to; i++) {
    if (marker.test(lines[i])) out.push({ from: i, to: i + 1, text: lines[i].replace(marker, "") });
    else if (out.length && /^\s+\S/.test(lines[i]) && out[out.length - 1].to === i) {
      out[out.length - 1].to = i + 1;
      out[out.length - 1].text += " " + lines[i].trim();
    }
  }
  return out.map((x) => ({ ...x, text: norm(x.text) }));
}

const NUMBERED = /^\s*\d+\.\s+/;
const BOX = /^\s*[-*]\s+\[( |x|X)\]\s+/;

function addLog(log, date, project, text) {
  const lines = String(log || "# Log\n").replace(/\r/g, "").split("\n");
  const entry = `- ${date} | ${project} | ${text}`;
  const first = lines.findIndex((l) => /^-\s+\d{4}-\d{2}-\d{2}/.test(l));
  if (first === -1) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", entry, "");
  } else lines.splice(first, 0, entry);
  return lines.join("\n");
}

function stamp(lines, date) {
  const i = lines.findIndex((l) => /^last updated:/i.test(l));
  if (i !== -1) lines[i] = `Last updated: ${date} (via admin)`;
}

// "ZZZippy: review and send..." reads better up top as "**ZZZippy.** Review and send...".
function asCurrent(text) {
  const m = /^([^:.]{2,48}):\s+(.+)$/.exec(text);
  return m ? `**${m[1]}.** ${m[2][0].toUpperCase()}${m[2].slice(1)}` : text;
}

function renumber(lines, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) if (NUMBERED.test(lines[i])) lines[i] = lines[i].replace(/^(\s*)\d+\./, `$1${++n}.`);
}

/* ---------- the edits: (read) => { files, message } ---------- */

export function doneCurrent({ expect }) {
  return async (read) => {
    const [now, log] = await Promise.all([read("NOW.md"), read("LOG.md")]);
    const lines = now.replace(/\r/g, "").split("\n");
    const cur = range(lines, /^current task/i);
    if (!cur) throw new Stale("NOW.md has no Current task section.");
    const text = norm(lines.slice(cur[0], cur[1]).join(" "));
    if (!text || /^nothing (queued|set)/i.test(text)) throw new Stale("There is no current task to finish.");
    if (expect !== undefined && norm(expect) !== text) throw new Stale("The current task changed since this page loaded. Refresh and try again.");

    // The queue sits below the current task, so take from it first: line numbers above stay put.
    let next = "";
    const q = range(lines, /^queue/i);
    if (q) {
      const first = items(lines, q[0], q[1], NUMBERED)[0];
      if (first) {
        next = asCurrent(first.text);
        lines.splice(first.from, first.to - first.from);
        renumber(lines, q[0], q[1] - (first.to - first.from));
      }
    }
    lines.splice(cur[0], cur[1] - cur[0], "", next || 'Nothing queued. Say "what\'s next?" in a hub session.', "");
    const date = today();
    stamp(lines, date);
    const done = plain(text);
    return {
      files: { "NOW.md": lines.join("\n"), "LOG.md": addLog(log, date, projectOf(text), `Done (via admin): ${done}`) },
      message: `hub: ${projectOf(text)} - done via admin: ${clip(done, 60)}`,
    };
  };
}

export function doneQueue({ index, text }) {
  return async (read) => {
    const [now, log] = await Promise.all([read("NOW.md"), read("LOG.md")]);
    const lines = now.replace(/\r/g, "").split("\n");
    const q = range(lines, /^queue/i);
    const item = q && items(lines, q[0], q[1], NUMBERED)[Number(index)];
    if (!item || item.text !== norm(text)) throw new Stale("The queue changed since this page loaded. Refresh and try again.");
    lines.splice(item.from, item.to - item.from);
    renumber(lines, q[0], q[1] - (item.to - item.from));
    const date = today();
    stamp(lines, date);
    const done = plain(item.text);
    return {
      files: { "NOW.md": lines.join("\n"), "LOG.md": addLog(log, date, projectOf(item.text), `Done (via admin): ${done}`) },
      message: `hub: ${projectOf(item.text)} - done via admin: ${clip(done, 60)}`,
    };
  };
}

// project: a file name under projects/ without ".md", or empty for NOW.md's own checklists.
export function setTask({ project, text, done }) {
  const id = String(project || "");
  if (id && !/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Stale("Unknown project.");
  const path = id ? `projects/${id}.md` : "NOW.md";
  return async (read) => {
    const [doc, log] = await Promise.all([read(path), read("LOG.md")]);
    const lines = doc.replace(/\r/g, "").split("\n");
    const item = items(lines, 0, lines.length, BOX).find((x) => x.text === norm(text));
    if (!item) throw new Stale("That task isn't there any more. Refresh and try again.");
    const was = /\[(x|X)\]/.test(BOX.exec(lines[item.from])[0]);
    if (was === Boolean(done)) throw new Stale(done ? "That task is already done." : "That task is already open.");
    lines[item.from] = lines[item.from].replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]");
    const date = today();
    if (id) {
      const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
      const at = lines.findIndex((l, i) => i < end && /^last_touched:/.test(l));
      if (at !== -1) lines[at] = `last_touched: ${date}`;
    } else stamp(lines, date);
    const what = plain(item.text);
    return {
      files: { [path]: lines.join("\n"), "LOG.md": addLog(log, date, id || "hub", `${done ? "Done" : "Reopened"} (via admin): ${what}`) },
      message: `hub: ${id || "hub"} - ${done ? "done" : "reopened"} via admin: ${clip(what, 60)}`,
    };
  };
}

// Claude's proposed rewrite of a project file, reviewed by Alexander on the
// page. `original` is the file as Claude read it: if the hub has moved on since,
// the edit refuses rather than overwrite someone else's change. `log` is the
// text of the LOG.md line (after "date | project |").
export function applyCorrection({ project, original, file, log }) {
  const id = String(project || "");
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Stale("Unknown project.");
  const path = `projects/${id}.md`;
  const text = String(file || "").replace(/\r/g, "").replace(/\s+$/, "") + "\n";
  if (!/^---\n[\s\S]*?\n---\n/.test(text) || !/^## Next action\s*$/m.test(text)) {
    throw new Stale("Claude's file is missing its front matter or Next action. Ask again.");
  }
  const line = norm(String(log || "").replace(/^-\s*/, "").replace(/^\d{4}-\d{2}-\d{2}\s*\|\s*[^|]*\|\s*/, "").replace(/\|/g, "/").replace(/\s*\(via admin\)/gi, "").replace(/^correction(\s+per\s+alexander)?\s*(\([^)]*\))?\s*:\s*/i, ""));
  if (!line) throw new Stale("Claude gave no LOG line. Ask again.");
  return async (read) => {
    const [current, logText] = await Promise.all([read(path), read("LOG.md")]);
    if (current.replace(/\r/g, "") !== String(original || "").replace(/\r/g, "")) {
      throw new Stale("The project file changed since Claude read it. Ask again.");
    }
    const date = today();
    const lines = text.split("\n");
    const end = lines.indexOf("---", 1);
    const at = lines.findIndex((l, i) => i > 0 && i < end && /^last_touched:/.test(l));
    if (at !== -1) lines[at] = `last_touched: ${date}`;
    else lines.splice(end, 0, `last_touched: ${date}`);
    return {
      files: { [path]: lines.join("\n"), "LOG.md": addLog(logText, date, id, `Correction (via admin): ${line}`) },
      message: `hub: ${id} - correction (via admin)`,
    };
  };
}
