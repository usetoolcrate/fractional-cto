// One-time (safe to re-run) Stripe setup for schottky.com/payments.
//   node --env-file=.env scripts/stripe-setup.mjs
// Creates the monthly prices, a "Client billing" payment-method setting
// (card + ACH bank debit) and the customer-portal configuration, then prints
// the env values the site needs.
import { isTestMode, stripe } from "../api/_lib/stripe.mjs";

const SITE = process.env.SITE_URL || "https://schottky.com";
const DESCRIPTOR = "SCHOTTKY WEBDEV";

const PRICES = [
  { lookup: "sw_build_care_250", product: "Website build & care", amount: 25000 },
  { lookup: "sw_hosting_140", product: "Hosting & maintenance", amount: 14000 },
  { lookup: "sw_social_360", product: "Social media management", amount: 36000 },
];

async function ensureProduct(name) {
  const found = await stripe("GET", "products/search", { query: `name:'${name}' AND metadata['portal']:'schottky'` });
  if (found.data[0]) return found.data[0];
  return stripe("POST", "products", { name, statement_descriptor: DESCRIPTOR, metadata: { portal: "schottky" } });
}

async function ensurePrice({ lookup, product, amount }) {
  const existing = await stripe("GET", "prices", { lookup_keys: [lookup], active: true });
  if (existing.data[0]) return existing.data[0];
  const prod = await ensureProduct(product);
  return stripe("POST", "prices", {
    product: prod.id,
    unit_amount: amount,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookup,
    metadata: { portal: "schottky" },
  });
}

async function ensurePaymentMethodConfig() {
  const list = await stripe("GET", "payment_method_configurations", { limit: 50 });
  const params = {
    name: "Client billing (schottky.com)",
    card: { display_preference: { preference: "on" } },
    us_bank_account: { display_preference: { preference: "on" } },
    link: { display_preference: { preference: "off" } },
    cashapp: { display_preference: { preference: "off" } },
  };
  const existing = list.data.find((c) => c.name === params.name && c.active);
  if (existing) return stripe("POST", `payment_method_configurations/${existing.id}`, params);
  return stripe("POST", "payment_method_configurations", params);
}

async function ensurePortal(pmc) {
  const list = await stripe("GET", "billing_portal/configurations", { limit: 50, active: true });
  const params = {
    business_profile: { headline: "Schottky WebDev · Client billing" },
    default_return_url: `${SITE}/payments`,
    login_page: { enabled: true },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true, payment_method_configuration: pmc.id },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { portal: "schottky" },
  };
  const existing = list.data.find((c) => c.metadata?.portal === "schottky");
  if (existing) return stripe("POST", `billing_portal/configurations/${existing.id}`, params);
  return stripe("POST", "billing_portal/configurations", params);
}

console.log(`Stripe mode: ${isTestMode() ? "TEST" : "LIVE"}`);
for (const p of PRICES) {
  const price = await ensurePrice(p);
  console.log(`price ${p.lookup}: ${price.id} ($${price.unit_amount / 100}/mo)`);
}
const pmc = await ensurePaymentMethodConfig();
console.log(`payment method configuration: ${pmc.id} (card ${pmc.card?.display_preference?.value}, ACH ${pmc.us_bank_account?.display_preference?.value})`);
const portal = await ensurePortal(pmc);
console.log("\nSet these in Vercel for this Stripe mode:");
console.log(`STRIPE_PORTAL_CONFIGURATION=${portal.id}`);
console.log(`STRIPE_PORTAL_LOGIN_URL=${portal.login_page?.url}`);
