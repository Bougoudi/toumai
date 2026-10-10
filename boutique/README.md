# HavenLume store

US storefront (English, USD) for the USB Heated Wearable Throw, with a cart, iyzico card
checkout, and an order desk for manual-assisted dropshipping: the owner receives paid
orders, places the supplier order personally, then records tracking.

Node.js 20+, Express, SQLite (better-sqlite3). No build step.

## Run locally
```bash
cd boutique
npm install
cp .env.example .env
npm run hash-password -- "a long admin password"   # paste the output into ADMIN_PASSWORD_HASH
npm start            # http://localhost:3000  — admin: /admin
npm test             # API tests (node:test)
npm run test:e2e     # browser tests (needs Playwright)
```

## Payment modes (automatic)
| Configuration | Checkout | Money |
|---|---|---|
| No iyzico keys | Demo orders (`HL-TEST-…`) | None. Demo orders can never be fulfilled |
| iyzico **sandbox** keys + `PUBLIC_URL` | iyzico hosted page, test cards | None |
| iyzico **live** keys + `PUBLIC_URL` + `LIVE_PAYMENTS_ENABLED=true` + `PRODUCT_COMPLIANCE_VERIFIED=true` | iyzico hosted page | Real |

Live keys without both flags keep checkout in demo mode. See `docs/PRODUCT_COMPLIANCE.md`.

### Why iyzico
The seller operates from Turkey. Stripe (stripe.com/global) and Shopify Payments
(help.shopify.com supported countries) do not list Turkey as of October 2026. iyzico is a
licensed Turkish payment institution that pays out to a Turkish bank account and supports
USD.

### How a payment is confirmed
1. `POST /api/checkout` validates the cart and the US address, **computes the total on the
   server**, saves a `pending` order and opens an iyzico Checkout Form.
2. The customer pays on iyzico's page. Card data never reaches this server.
3. iyzico returns the customer to `POST /api/checkout/iyzico/callback`, and can also call
   `POST /api/webhooks/iyzico`. Webhooks need a valid `X-IYZ-SIGNATURE-V3` (HMAC-SHA256
   with the secret key), are de-duplicated, and only *trigger* a check.
4. The order becomes `paid` only after the server **retrieves the payment from iyzico's
   authenticated API** and confirms: status SUCCESS, same token and basket, currency USD,
   paid amount ≥ total, and fraud status approved. Declined → `failed`. Anything unclear
   stays `pending`, with the reason in the order history.
5. The admin gets an alert (dashboard + optional email/Discord/Slack).

Refunds (partial or full) run through iyzico's refund API from the order page, or can be
recorded when they were made in the iyzico panel. Each refund has an idempotency key.

## Order desk (`/admin`)
- **Dashboard**: paid orders, revenue retained, refunds, costs (estimated vs actual),
  estimated profit and margin.
- **Order**: customer and address, items, payment, refunds, history.
- **Copy Supplier Order**: order reference, supplier SKU, colour, quantity, recipient and
  address. Phone only when ticked, with the supplier instructions. No email, prices or
  payment data.
- **Supplier order**: date, supplier reference, actual product and shipping cost,
  confirmation.
- **Shipment**: carrier, tracking number, https tracking link, ship date. Without a
  tracking number, a verified justification is required. The customer email is prepared,
  and sent only if Resend is configured; otherwise it is marked "prepared — NOT sent".
- **Statuses**: payment `pending · paid · failed · partially_refunded · refunded`;
  logistics `unfulfilled · supplier_order_prepared · supplier_ordered · shipped · delivered
  · cancelled · return_requested · returned`. Transitions are enforced on the server, and
  only verified paid orders can move toward shipping.
- **Settings**: cost estimates (27.24 + 15.00 = **42.24 USD/unit** by default), payment-fee
  estimate, database backup download. **Activity**: audit log of admin actions.

Profit = retained revenue (paid − refunds) − product − shipping − payment fees − ads − other.
Margin = profit ÷ retained revenue × 100. Actual costs replace estimates once recorded.

## Analytics (`/admin` → Analytics)
First-party, cookieless statistics stored in the store's own SQLite database. There is no
Google Analytics, no third-party script, and nothing to sign up for.

**Why this choice** (October 2026):
- **GA4** is free, but it uses cookies (a consent banner is required for EU/UK visitors
  and advisable elsewhere), is often blocked by ad blockers, and needs a Google Cloud
  service account plus the Data API to show figures in this admin.
- **Umami Cloud's** free *Hobby* plan has **no API access** (it starts with Pro at
  $20/month), so it can't feed this admin. Self-hosting Umami on Render needs PostgreSQL
  and a second service.
- **Internal** (chosen): $0, works immediately, no cookies and no third party. Data lives
  with your orders, so on Render it needs the same persistent disk.

**What it measures**:
- Unique visitors, estimated per day: SHA-256 of a daily random salt + IP + user agent.
  The salt is deleted the next day, so a person visiting on 3 days counts 3 times.
- Sessions (30-minute inactivity gap), page views, and active visitors (last 5 minutes).
- Countries, top pages and referrers.
- Events: `page_view`, `view_item`, `add_to_cart` (the buy button), `begin_checkout`,
  `add_payment_info` (the "Continue to payment" click) and `purchase`.
- Commerce figures from the order database: orders started, paid orders, revenue.

**Rules**:
- `purchase` is written **only by the server**, once, when iyzico confirms a non-test
  payment. The browser cannot send it.
- Event properties are whitelisted: product id, variant id, quantity, value, currency.
- Paths lose their query strings. Admin pages and the logged-in admin's own browsing are
  never counted, and bots are filtered out.

**Country** is estimated with the free **DB-IP Lite** database (CC BY 4.0, downloaded
automatically each month, attribution shown). The IP is looked up in memory and never
stored. Estimates can be wrong with VPNs, proxies, corporate and mobile networks.

**Privacy choices**:
- `ANALYTICS_CONSENT_MODE=opt-out` (default): visitors are measured unless they decline
  with the "Privacy choices" link in the footer.
- `ANALYTICS_CONSENT_MODE=opt-in`: a banner is shown, and nothing is sent before the
  visitor accepts.
- Global Privacy Control and Do Not Track are honoured in the browser and on the server.

The privacy policy describes all of this. Whether opt-out is enough for your audience is
a legal question: use opt-in if you target EU/UK visitors, and have the policy reviewed.

## Security
- Admin: scrypt password hash, server-side sessions in SQLite (only a SHA-256 of the
  token is stored), `HttpOnly; SameSite=Strict` cookie (`__Host-`, `Secure` in
  production), CSRF token on every admin write, origin check, login rate limit, audit log.
- Every admin route is checked on the server; `/admin.html` is not public.
- Helmet with a strict Content-Security-Policy (no inline scripts), HSTS in production.
- Input validation (US states, ZIP, email, quantities, https tracking links),
  parameterised SQL only, request size limits, rate limits.
- No secrets in the code or sent to the browser; errors are logged with a reference
  instead of request bodies.
- Daily SQLite backups (rotated) plus an on-demand download in Settings.

## Deploy on Render
Already created: service `havenlume`. Build `cd boutique && npm ci --omit=dev`,
start `cd boutique && node server.js`.
1. **Persistent disk (required for real orders)**: plan Starter or higher, add a disk
   mounted at `/var/data`, then set `DB_PATH=/var/data/havenlume.sqlite`. On the free plan
   the database is wiped at every deploy or restart.
2. Environment: see `.env.example` (`NODE_ENV=production`, `TRUST_PROXY=true`,
   `PUBLIC_URL`, `ADMIN_PASSWORD_HASH`, `STATUS_LINK_SECRET`, iyzico keys…).

## iyzico account steps
1. Sandbox: create an account at https://sandbox-merchant.iyzipay.com, copy the API key
   and secret key, and test with card `5528 7900 0000 0008` (any future date, CVC 123).
2. Webhook: in the merchant panel, set the notification URL to
   `https://<your-domain>/api/webhooks/iyzico`, and ask iyzico (entegrasyon@iyzico.com) to
   enable **X-IYZ-SIGNATURE-V3**.
3. Live: open a merchant account (registered business), enable **USD** and **foreign
   cards**, confirm what identity number to send for US buyers
   (`IYZICO_BUYER_IDENTITY_NUMBER`), then set the live keys and
   `IYZICO_URI=https://api.iyzipay.com`.

## Files
- `server.js`: entry point.
- `src/app.js`: routes and security middleware.
- `src/orders.js`: order rules (checkout, payment confirmation, refunds, logistics, supplier text, emails).
- `src/iyzico.js`: iyzico checkout, retrieval, webhook signature, refunds, live-mode gate.
- `src/profit.js`: profit and dashboard maths (integer cents).
- `src/db.js`: SQLite schema and migrations.
- `src/auth.js`: admin sessions, CSRF and audit log.
- `src/notify.js`: emails (Resend) and admin alerts.
- `src/catalog.js`: product, variants, supplier SKU.
- `src/backup.js`: backups.
- `src/analytics.js`: analytics collection, privacy rules and admin reports.
- `src/geoip.js`: IP → country with DB-IP Lite, in memory.
- `src/config.js`: environment configuration.
- `public/`: storefront pages and `js/`, admin (`admin.html`, `js/admin.js`).
- `test/store.test.js`, `test/analytics.test.js`: API tests (`test/helpers.js` is the shared harness).
- `test/e2e.cjs`, `test/e2e-analytics.cjs`: browser tests.
- `docs/PRODUCT_COMPLIANCE.md`: documents required before live payments.
