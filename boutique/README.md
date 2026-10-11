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

## Product information (`/admin` → Product info)

Every technical detail customers see (specs table, "How USB power works", box contents,
"Is it right for you?", FAQ answers) comes from this form. **Nothing is pre-filled**: an
empty field is shown on the store as "Being confirmed with our supplier", never guessed.
Fill a field only from the supplier's documentation for the exact model (manual, label,
spec sheet). The dashboard shows how many details are still to confirm.

The full list of questions to send the supplier (SKU, power input, power bank and tested
runtime, heat settings and zones, box contents, cleaning, manual, processing vs transit
time, compliance documents) is in `docs/SUPPLIER_FACT_SHEET.md`. Internal fields (SKU,
manual received, compliance documents) are never published.

The product page answers the main buyer objections in **Common Questions, Clear Answers**
and shows a **Before You Order** block (key specs, power source, box contents, safety,
delivery & returns, contact) in the buy box, on the cart and at checkout.

Fixed precautions are always shown (never while sleeping, not for infants/children or
anyone who can't remove it, disconnect before cleaning). `test/product-facts.test.js`
fails if a public page claims a certification, a medical benefit, reviews, fake urgency
or use while sleeping.

## Supplier checklist, anomalies and holds (order drawer)

Each paid order has a preparation checklist: SKU, color/variant, quantity, expected
accessories and address must be ticked before the supplier order can be saved (a confirmed
SKU that differs from the order's SKU is refused; set `SUPPLIER_PRODUCT_SKU`). Tracking is
filled automatically; "customer informed" is yours to tick. Anomalies can put an order
**on hold**, which blocks the supplier and shipment steps until resolved. Every action is
in the order history and the activity log. These are records of your checks, not a
physical inspection of the parcel.

## Customer reviews (product page + `/admin` → Reviews)

**Off by default.** Nothing about reviews exists (no database migration, no routes, no page
section, no admin tab) until you set `REVIEWS_ENABLED=true`. Download a backup first; the
restart then migrates the database to schema v6. See `docs/implementation-tracking.md`.

- Customers submit a review on the product page (rating, public name, optional title, comment,
  "Did you purchase…", "Would you recommend…", required honesty/publication consent). The same
  rules run in the browser and on the server (`public/js/review-rules.js`).
- Every review is **pending** until you approve it. Only approved reviews are public, with the real
  average, count and 1–5 distribution. No demo or seeded reviews exist.
- Moderation: approve, reject, hide, erase content — with fixed reasons (spam, insults, personal
  information, off-topic, conflict of interest, duplicate, customer request). Never reject a review
  for being negative. Every action is in the review's history and the activity log.
- **Verified Purchase** only via a single-use link e-mailed to the address of a paid, shipped or
  delivered, non-refunded, non-test order. Needs `RESEND_API_KEY` + `EMAIL_FROM` + `PUBLIC_URL`;
  without them the form says verification isn't available and nothing is sent.
- Post-delivery review request: button in the order drawer (delivered orders, e-mail configured,
  sent once, honest review, no reward).
- Rules for customers: `/review-policy`. Details: `docs/reviews/`, tracking: `docs/implementation-tracking.md`.
- Limits: `REVIEW_SUBMIT_LIMIT` (default 5 per 15 min per IP), `REVIEW_VERIFY_LIMIT` (default 5 link requests per hour).

## E-mail list and welcome code

The home and product pages invite visitors (once, dismissible, never over the privacy choices,
the mobile buy bar, the cart or the checkout) to join the e-mail list; the cart and the footer
have a sign-up form too. Subscribers get **WELCOME10** (10% off), valid **once per subscribed
e-mail address**, checked by the server at payment. The code is recreated at every start from
`NEWSLETTER_*` settings, so a database reset never leaves subscribers with a dead code.
Without an e-mail provider the code is shown on screen and nothing claims an e-mail was sent.
`/admin` → Marketing → **Email list**: counts, list, CSV export, delete on request. Add
`STORE_BUSINESS_ADDRESS` before sending any marketing e-mail (CAN-SPAM), and always include
the unsubscribe link. Timing and wording choices: `docs/GOOGLE_TRENDS_INSIGHTS.md`.

## Payment logos
Once checkout is open (sandbox or live), the footer, home page and checkout show the logos listed
in `PAYMENT_METHODS` (default `visa,mastercard,amex`). Optional values: `apple-pay`,
`google-pay`, `unionpay`. List only the methods your iyzico account actually accepts.
PayPal, Shop Pay, Bancontact and iDEAL/Wero are not offered through iyzico, so they are
not available. Icons: [activemerchant/payment_icons](https://github.com/activemerchant/payment_icons)
(MIT, see `public/images/payment/LICENSE-activemerchant-payment_icons.txt`); the logos
are the trademarks of their owners.

## Marketing (`/admin` → Marketing)
Nothing is posted to TikTok, Instagram, Facebook, YouTube or Google from the store, and
no ad platform is connected. Ad spend is entered by hand.

**Campaigns**
- Each campaign records a name, channel, objective, budget, dates, actual ad spend and a
  UTM tag. It generates a tracking link: `/product?utm_source=…&utm_medium=…&utm_campaign=…`.
- Results are shown in separate columns, never merged:
  - **visits**, product views, add to cart and checkout (from the store's own analytics);
  - **orders created**;
  - **paid orders**, confirmed by iyzico;
  - revenue, recorded spend, **cost per customer** (spend ÷ paid orders), ROAS and profit
    after ads.
- A metric with no data shows "—" with an explicit flag, for example "No ad spend
  recorded" or "No confirmed payment yet — profitability not demonstrated". The store
  never recommends raising a budget.

**Attribution**
- `utm_*` tags from the landing URL are stored on the analytics session (first touch) and
  on the order. This only happens if the visitor has not opted out of analytics.
- Values are strictly formatted (`[a-z0-9._-]`, 60 characters), and anything else is
  dropped.
- Record ad spend **on the campaign**. Recording it on orders as well triggers a
  double-count warning.

**Content calendar**
- The three angles: comfort while working from home, relaxing at home, cold-season gifts.
- Each item has a hook, script, channel, status (idea → to produce → ready → published),
  publish date, published URL (https, required to mark it published), linked campaign
  and `utm_content`, which gives each post its own tracking link.
- "Add 3 starter ideas" creates drafts that make no product claims.

**Promo codes**
- Percentage (1–50%) or fixed amount, applied to the product subtotal (shipping
  excluded). Optional minimum subtotal, real start and end dates, and an optional cap on
  paid orders.
- The discount is computed on the server (`/api/quote` and again at checkout) and spread
  across the iyzico basket lines, so **iyzico charges the discounted amount**. Payment
  verification checks that amount.
- An invalid or expired code refuses the checkout; it never silently charges full price.
  Customers see the exact conditions.
- No countdowns, no struck-through "was" prices.

**Banner**: text, optional link and code, real start and end dates. It is hidden
automatically outside its dates, or when its code stops being valid.

**Margin calculator**: amount charged after discount − 42.24 USD (27.24 + 15) per unit −
configured payment fees − ad cost − other costs, with the break-even ad cost per order.
It is a simulation; real results are in the dashboard and the campaign table.

## SEO & sharing
- Title and description per page.
- Canonical URLs, Open Graph and Twitter cards with 1200×630 images, injected by the
  server.
- `robots.txt` (admin, API, cart, checkout and order status excluded) and `sitemap.xml`.
- WebP images in two sizes, with explicit dimensions and long cache headers.
- **Product JSON-LD** with name, images, price, availability, and the store's own
  published return and shipping policies. Delivery time is added only when
  `DELIVERY_ESTIMATE_VERIFIED=true`. **No ratings, reviews, certifications or GTIN.**
- **Google Merchant Center feed**: `/feeds/google-merchant.xml`, listing available colors
  only (requires `PUBLIC_URL`).
- Search Console / Merchant Center site verification via `GOOGLE_SITE_VERIFICATION`.
- Setup steps: `docs/GOOGLE_MERCHANT_CENTER.md`.

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
- `src/marketing.js`: campaigns, content calendar, banner and campaign report.
- `src/promotions.js`: promo codes, validated and computed server-side.
- `src/utm.js`: UTM validation and tracking links.
- `src/seo.js`: canonical, Open Graph, JSON-LD, robots, sitemap, Merchant feed.
- `public/js/admin-marketing.js`: the Marketing tab.
- `src/config.js`: environment configuration.
- `public/`: storefront pages and `js/`, admin (`admin.html`, `js/admin.js`).
- `test/store.test.js`, `test/analytics.test.js`, `test/marketing.test.js`: API tests (`test/helpers.js` is the shared harness).
- `test/e2e.cjs`, `test/e2e-analytics.cjs`, `test/e2e-marketing.cjs`: browser tests.
- `docs/PRODUCT_COMPLIANCE.md`: documents required before live payments.
