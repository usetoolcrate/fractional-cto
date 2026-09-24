// Create (or find) a client in Stripe and issue a new /payments sign-in code.
//   node --env-file=.env scripts/new-client.mjs --name "Dyllan Dale" --email dyllan@example.com --prefix WFD
// The code is printed once and only its hash is stored. Re-running for the same
// email issues a fresh code and the old one stops working.
import { parseArgs } from "node:util";
import { generateCode, hashCode } from "../api/pay/_lib/codes.mjs";
import { isTestMode, stripe } from "../api/pay/_lib/stripe.mjs";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    prefix: { type: "string", default: "" },
    "test-clock": { type: "string" },
  },
});
if (!values.name || !values.email) {
  console.error('Usage: --name "Client Name" --email client@example.com [--prefix ABC]');
  process.exit(1);
}

const email = values.email.trim().toLowerCase();
const code = generateCode(values.prefix);
const metadata = { portal: "schottky", portal_code_sha256: hashCode(code) };

const found = values["test-clock"]
  ? { data: [] }
  : await stripe("GET", "customers/search", { query: `email:'${email}' AND metadata['portal']:'schottky'` });

const customer = found.data[0]
  ? await stripe("POST", `customers/${found.data[0].id}`, { name: values.name, metadata })
  : await stripe("POST", "customers", {
      name: values.name,
      email,
      metadata,
      test_clock: values["test-clock"],
    });

console.log(`Stripe mode: ${isTestMode() ? "TEST" : "LIVE"}`);
console.log(`${found.data[0] ? "Updated" : "Created"} customer ${customer.id} (${customer.name}, ${customer.email})`);
console.log(`\nClient code: ${code}`);
console.log("Give this to the client with the link https://schottky.com/payments. It can take up to a minute before it works.");
