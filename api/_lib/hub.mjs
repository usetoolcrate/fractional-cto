// The task hub behind /admin/work. The hub is a private GitHub repo of markdown
// (aschottky/hub: NOW.md, LOG.md, INBOX.md, projects/*.md) that Claude keeps
// current. This reads it with a read-only token and turns it into JSON for the
// page. Nothing here writes: corrections go through a hub session.
//
// Env: HUB_GITHUB_TOKEN (fine-grained token, Contents: read-only, on the hub
// repo only), HUB_REPO (default "aschottky/hub"), HUB_BRANCH (default "main").

const REPO = () => process.env.HUB_REPO?.trim() || "aschottky/hub";
const BRANCH = () => process.env.HUB_BRANCH?.trim() || "main";
const CACHE_MS = 60 * 1000;
let cache = null; // { at, data } — per warm function instance

async function gh(path, raw) {
  const token = process.env.HUB_GITHUB_TOKEN?.trim();
  if (!token) throw new Error("HUB_GITHUB_TOKEN is not set");
  const url = `https://api.github.com/repos/${REPO()}/${path}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "schottky-admin-work",
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path.split("?")[0]}`);
  return raw ? r.text() : r.json();
}

const file = (name) => gh(`contents/${name}?ref=${encodeURIComponent(BRANCH())}`, true);

export async function loadHub({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const ref = encodeURIComponent(BRANCH());
  const [now, log, inbox, listing, commits] = await Promise.all([
    file("NOW.md"),
    file("LOG.md"),
    file("INBOX.md").catch(() => ""),
    gh(`contents/projects?ref=${ref}`),
    gh(`commits?sha=${ref}&per_page=1`).catch(() => []),
  ]);
  const names = (Array.isArray(listing) ? listing : [])
    .filter((f) => f.type === "file" && f.name.endsWith(".md") && !f.name.startsWith("_"))
    .map((f) => f.name);
  const projects = await Promise.all(names.map(async (name) => ({ name, text: await file(`projects/${name}`) })));
  const data = parseHub({ now, log, inbox, projects });
  data.repo = REPO();
  data.commit = commits[0]
    ? { sha: commits[0].sha.slice(0, 7), at: commits[0].commit?.committer?.date || null, message: (commits[0].commit?.message || "").split("\n")[0] }
    : null;
  data.fetchedAt = new Date().toISOString();
  cache = { at: Date.now(), data };
  return data;
}

/* ---------- markdown, just enough for the hub's own files ---------- */

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (line) => /^\s*\|?\s*:?-{3,}/.test(line) && /^[\s|:-]+$/.test(line);

// Lines -> blocks: p, table, ol, ul, tasks, code. Wrapped list lines are joined.
export function blocks(lines) {
  const out = [];
  let i = 0;
  const push = (b) => out.push(b);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      push({ type: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim().startsWith("|") && lines[i + 1] && isRule(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      push({ type: "table", head, rows });
      continue;
    }

    const item = /^\s*(?:[-*]|\d+\.)\s+/;
    if (item.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        if (item.test(lines[i])) items.push(lines[i].replace(item, "").trim());
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += " " + lines[i].trim();
        else break;
        i++;
      }
      const box = /^\[( |x|X)\]\s+/;
      if (items.length && items.every((t) => box.test(t))) {
        push({ type: "tasks", items: items.map((t) => ({ done: /^\[(x|X)\]/.test(t), text: t.replace(box, "") })) });
      } else {
        push({ type: ordered ? "ol" : "ul", items });
      }
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !item.test(lines[i]) && !/^\s*```/.test(lines[i]) && !lines[i].trim().startsWith("|")) {
      para.push(lines[i++].trim());
    }
    if (para.length) push({ type: "p", text: para.join(" ") });
    else i++;
  }
  return out;
}

// "## Title" sections; anything before the first one lands in `intro`.
export function sections(text) {
  const out = { title: "", intro: [], sections: [] };
  let current = null;
  let buf = [];
  const flush = () => {
    const b = blocks(buf);
    if (current) current.blocks = b;
    else out.intro = b;
    buf = [];
  };
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    const h1 = /^#\s+(.+)/.exec(line);
    const h2 = /^##\s+(.+)/.exec(line);
    if (h2) { flush(); current = { title: h2[1].trim(), blocks: [] }; out.sections.push(current); }
    else if (h1 && !out.title && !current) out.title = h1[1].trim();
    else buf.push(line);
  }
  flush();
  return out;
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(String(text || "").replace(/\r/g, ""));
  const meta = {};
  if (!m) return { meta, body: text || "" };
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: String(text).replace(/\r/g, "").slice(m[0].length) };
}

const find = (doc, re) => doc.sections.find((s) => re.test(s.title));

function parseProject({ name, text }) {
  const { meta, body } = frontmatter(text);
  const doc = sections(body);
  const next = find(doc, /^next action/i);
  const tasks = (find(doc, /^tasks/i)?.blocks || []).filter((b) => b.type === "tasks").flatMap((b) => b.items);
  const list = (re) => (find(doc, re)?.blocks || []).flatMap((b) => (b.type === "ul" || b.type === "ol" ? b.items : b.type === "p" ? [b.text] : []));
  const waiting = list(/^waiting/i).filter((t) => !/^(nothing|none)\b/i.test(t));
  return {
    id: name.replace(/\.md$/, ""),
    name: meta.project || name.replace(/\.md$/, ""),
    type: meta.type || "",
    status: (meta.status || "").split(/\s/)[0].toLowerCase() || "unknown",
    money: meta.money || "",
    deadline: meta.deadline && meta.deadline !== "none" ? meta.deadline : "",
    touched: /^\d{4}-\d{2}-\d{2}/.test(meta.last_touched || "") ? meta.last_touched.slice(0, 10) : "",
    handoff: meta.handoff || "",
    repos: (meta.repos || "").replace(/^\[|\]$/g, ""),
    next: (next?.blocks || []).filter((b) => b.type === "p").map((b) => b.text).join(" "),
    tasks,
    open: tasks.filter((t) => !t.done).length,
    done: tasks.filter((t) => t.done).length,
    waiting,
    notes: list(/^notes/i),
    unconfirmed: /CONFIRM/.test(text),
  };
}

function parseLog(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*(.+)$/.exec(line);
    if (m) out.push({ date: m[1], project: m[2], text: m[3].trim() });
  }
  return out;
}

function parseInbox(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)$/.exec(line);
    if (m) out.push({ date: m[1], text: m[2].trim() });
  }
  return out;
}

export function parseHub({ now, log, inbox, projects }) {
  const doc = sections(now);
  const updated = doc.intro.find((b) => b.type === "p" && /^last updated/i.test(b.text));
  return {
    now: {
      updated: updated ? updated.text.replace(/^last updated:\s*/i, "") : "",
      intro: doc.intro.filter((b) => b !== updated),
      sections: doc.sections,
    },
    projects: (projects || []).map(parseProject),
    log: parseLog(log),
    inbox: parseInbox(inbox),
  };
}
