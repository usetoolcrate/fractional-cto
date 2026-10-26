// Arrangements paid outside Stripe (Venmo, Zelle, a check): nothing is charged,
// but the admin page keeps track of what's due and when, and each payment is
// recorded as a Stripe invoice marked "paid out of band" so the client gets a
// receipt and the history shows up in both invoice lists.
//
// Stored in customer metadata `manual_plan` (compact JSON):
// { a: amount cents, i: "month" | "year", m: method label, s: first due date,
//   n: next due date (YYYY-MM-DD), t: optional note }

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function decodeManual(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || !(v.a > 0) || !["month", "year"].includes(v.i) || !YMD.test(v.n || "")) return null;
    return { amount: v.a, interval: v.i, method: v.m || "Outside Stripe", start: YMD.test(v.s || "") ? v.s : v.n, next: v.n, note: v.t || "" };
  } catch {
    return null;
  }
}

export function encodeManual({ amount, interval, method, start, next, note }) {
  const s = JSON.stringify({ a: amount, i: interval, m: method, s: start, n: next, ...(note ? { t: note } : {}) });
  if (s.length > 500) throw new Error("That note is too long.");
  return s;
}

// YYYY-MM-DD plus n months, keeping the day where the month allows it
// (Jan 31 + 1 month = Feb 28). Pure calendar math, no time zones involved.
export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function addInterval(ymd, interval, n = 1) {
  return addMonths(ymd, (interval === "year" ? 12 : 1) * n);
}

// The day before a date, for "Oct 1, 2026 – Sep 30, 2027" period labels.
export function dayBefore(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function longDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export const isYmd = (s) => YMD.test(s || "");
