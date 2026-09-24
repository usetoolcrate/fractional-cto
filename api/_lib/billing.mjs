// Shared billing helpers for the admin tools and scripts.
import { adminStripe } from "./stripe.mjs";

const DESCRIPTOR = "SCHOTTKY WEBDEV";

// Unix seconds for 00:00 America/Chicago on YYYY-MM-DD (handles CDT/CST).
export function centralMidnight(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const offset of ["-05:00", "-06:00"]) {
    const t = new Date(`${ymd}T00:00:00${offset}`);
    if (Number.isNaN(t.getTime())) return null;
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    if (p.hour === "00" && `${p.year}-${p.month}-${p.day}` === ymd) return Math.floor(t.getTime() / 1000);
  }
  return null;
}

export function todayCentral() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

// Reuse a monthly price for (product name, amount) if one exists, else create it.
// Lists instead of search so a product created a moment ago is found.
export async function monthlyPrice(name, amount) {
  const products = await adminStripe("GET", "products", { active: true, limit: 100 });
  let product = products.data.find((p) => p.metadata?.portal === "schottky" && p.name === name);
  if (!product) {
    product = await adminStripe("POST", "products", { name, statement_descriptor: DESCRIPTOR, metadata: { portal: "schottky" } });
  }
  const prices = await adminStripe("GET", "prices", { product: product.id, active: true, type: "recurring", limit: 100 });
  const price = prices.data.find(
    (p) => p.unit_amount === amount && p.currency === "usd" && p.recurring?.interval === "month" && p.recurring?.interval_count === 1,
  );
  if (price) return price;
  return adminStripe("POST", "prices", {
    product: product.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { portal: "schottky" },
  });
}

export async function productNames() {
  const products = await adminStripe("GET", "products", { limit: 100 });
  return Object.fromEntries(products.data.map((p) => [p.id, p.name]));
}
