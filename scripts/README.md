# Client payments (schottky.com/payments)

Clients sign in with a client code (or get a sign-in link from Stripe by email), see their plan, next charge and invoices, and set up autopay by card or bank account (ACH). Stripe is the only database: codes are stored as a SHA-256 hash in the customer's metadata.

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
   node --env-file=.env scripts/new-client.mjs --name "Client Name" --email client@example.com --prefix ABC
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
