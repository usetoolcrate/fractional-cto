// Put a client on a phased monthly plan that runs itself.
//   node --env-file=.env scripts/create-schedule.mjs --customer cus_123 --start 2026-10-01 \
//     --phases sw_build_care_250:18,sw_hosting_140:ongoing
// Each phase is <price lookup key>:<months>. The last phase may be "ongoing":
// the schedule then releases and the subscription keeps billing that price.
// Charges happen automatically on the start day each month (card or ACH on file).
import { parseArgs } from "node:util";
import { centralMidnight } from "../api/_lib/billing.mjs";
import { isTestMode, stripe } from "../api/_lib/stripe.mjs";

const { values } = parseArgs({
  options: {
    customer: { type: "string" },
    start: { type: "string" },
    phases: { type: "string" },
  },
});
if (!values.customer || !values.start || !values.phases) {
  console.error("Usage: --customer cus_... --start YYYY-MM-DD --phases lookup:months,lookup:ongoing");
  process.exit(1);
}

const startDate = centralMidnight(values.start); // 00:00 Central, DST-aware
if (!startDate) throw new Error(`Bad --start date: ${values.start}`);

const specs = values.phases.split(",").map((s) => {
  const [lookup, months] = s.split(":");
  return { lookup, months };
});

const phases = [];
for (const [i, spec] of specs.entries()) {
  const prices = await stripe("GET", "prices", { lookup_keys: [spec.lookup], active: true });
  if (!prices.data[0]) throw new Error(`No active price with lookup key ${spec.lookup}`);
  const ongoing = spec.months === "ongoing";
  if (ongoing && i !== specs.length - 1) throw new Error("Only the last phase can be ongoing");
  const count = ongoing ? 1 : Number(spec.months);
  if (!Number.isInteger(count) || count < 1) throw new Error(`Bad month count in ${spec.lookup}:${spec.months}`);
  phases.push({
    items: [{ price: prices.data[0].id, quantity: 1 }],
    duration: { interval: "month", interval_count: count },
    proration_behavior: "none",
  });
}

const schedule = await stripe("POST", "subscription_schedules", {
  customer: values.customer,
  start_date: startDate,
  end_behavior: "release",
  default_settings: { collection_method: "charge_automatically" },
  phases,
});

console.log(`Stripe mode: ${isTestMode() ? "TEST" : "LIVE"}`);
console.log(`Schedule ${schedule.id} (${schedule.status}) for ${values.customer}`);
for (const p of schedule.phases) {
  console.log(`  ${new Date(p.start_date * 1000).toISOString().slice(0, 10)} → ${new Date(p.end_date * 1000).toISOString().slice(0, 10)}`);
}
