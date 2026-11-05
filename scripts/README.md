# Client payments (schottky.com/payments)

Clients sign in with a client code (or get a sign-in link from Stripe by email), see their plan, next charge and invoices, and set up autopay by card or bank account (ACH). Stripe is the only database: codes are stored as a SHA-256 hash in the customer's metadata. A code is six characters from a 32-character alphabet with no I, L, O or U, so it reads aloud cleanly.

- Page: `payments/index.html`
- Functions: `api/pay/*.mjs` (client), `api/admin/*.mjs` (admin); shared code in `api/_lib/`. No npm dependencies: Stripe and Resend REST via `fetch`, Stripe API version pinned in `api/_lib/stripe.mjs`
- Scripts: this folder. It's excluded from deploys by `.vercelignore`.

## Environment

The site's Vercel project (`fractional-cto`) and the local `.env` file (git-ignored, deploy-ignored) need:

| Name | What |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe key. Test key (`sk_test_…`) for Preview and local; live key for Production |
| `PORTAL_SESSION_SECRET` | Random 64-char hex that signs the sign-in cookie (`openssl rand -hex 32`) |
| `STRIPE_PORTAL_CONFIGURATION` | `bpc_…` printed by `stripe-setup.mjs` |
| `STRIPE_PORTAL_LOGIN_URL` | `https://billing.stripe.com/p/login/…` printed by `stripe-setup.mjs` |

Test and live mode have separate prices, portal configuration and login URL, so run `stripe-setup.mjs` once per mode.

## One-time setup per Stripe mode

```bash
node --env-file=.env scripts/stripe-setup.mjs
```

This is safe to re-run. It creates:
- the monthly prices (`sw_build_care_250`, `sw_hosting_140`, `sw_social_360`), with the card statement name set to "SCHOTTKY WEBDEV"
- a "Client billing" payment-method setting (card + ACH)
- the customer-portal configuration, with its email sign-in page turned on

## Onboarding a client

1. Create the client and a code. The code is printed once. Re-running issues a new code and the old one stops working.
   ```bash
   node --env-file=.env scripts/new-client.mjs --name "Client Name" --email client@example.com
   ```
2. Put them on a plan that runs itself. Each phase is `<price lookup key>:<months>`; the last phase may be `ongoing`. For a new rate, first add a price with a new lookup key in Stripe (or extend `PRICES` in `stripe-setup.mjs`).
   ```bash
   node --env-file=.env scripts/create-schedule.mjs --customer cus_... --start 2026-10-01 \
     --phases sw_build_care_250:18,sw_hosting_140:ongoing
   ```
   `--start` is midnight Central time (daylight saving handled automatically).

   Everything in steps 1–3 can also be done from the admin page at `/admin`, which is the normal way.
3. Send the client `https://schottky.com/payments` and their code, and ask them to set up autopay before the first charge. Customer search can take about a minute to pick up a new code.

## Stripe Dashboard settings (per mode)

- **Settings → Billing → Customer emails:** send receipts for successful payments; send emails when payments fail, with the link to update the payment method.
- **Settings → Billing → Automatic collection:** keep Smart Retries on.
- **Settings → Branding:** logo, icon and colors are used on Stripe's portal and invoice pages.
- **Settings → Public details:** the business name clients see is currently "Schottky LLC", with display name "Schottky WebDev".

## Adding the $360 social add-on to a client later

Update the client's schedule: add the `sw_social_360` price as a second item in **every** current and future phase, in one update. Stripe unsets anything you leave out.

## Site list (schottky.com/admin/sites)

Every site I've built, with its links, client, details and passwords, behind the same admin sign-in. The repo is public, so the list isn't in it:

- The list is one JSON file per environment (`sites/production.json`, `sites/preview.json`) in the private Blob store `schottky-sites`, linked to this project (`BLOB_READ_WRITE_TOKEN`).
- Passwords are sealed before they're stored: RSA-OAEP wraps a one-off AES-256-GCM key. The private key is `SITES_PRIVATE_KEY` (base64 PEM, sensitive, Production and Preview); the public half is `scripts/sites-public.pem`. The stored file and the Blob browser show no passwords.
- `api/_lib/sites-seed.mjs` (git-ignored, but deployed) holds starter entries. Each is added once by id, so a site removed in the admin stays removed. To add a site from here, append it with a new id and deploy. Seal a password for it with:

```bash
printf '%s' "$VALUE" | node scripts/seal.mjs
```

If `SITES_PRIVATE_KEY` is ever replaced, the saved passwords can't be opened any more; type them in again in the admin.

### Stats on the Sites page

Each site can carry an Analytics property ID, a Search Console property and a Clarity project ID (edit the site, "Stats"). `api/_lib/stats.mjs` reads the last 28 days (and the 28 before) from both Google APIs and caches them for three hours in the same Blob store (`stats/<env>.json`); "Refresh" on the page skips the cache.

There is no Google key anywhere. Google Cloud project `schottky-site-stats` (owner alexschottky@gmail.com) has a Workload Identity Federation pool `vercel` with provider `fractional-cto`, which trusts Vercel's OIDC tokens (issuer `https://oidc.vercel.com/aschottkys-projects`) only for this project. The token is exchanged for one of the read-only service account `site-stats@schottky-site-stats.iam.gserviceaccount.com` (`api/_lib/google.mjs`).

To add a site's stats: in Analytics, add that service account as a **Viewer** on the property (Admin → Property access management, notification email off); in Search Console, add it as a **Restricted** user (Settings → Users and permissions). Then put the IDs on the site.
