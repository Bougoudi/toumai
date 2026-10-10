# HavenLume Boutique Starter

A responsive storefront and an initial order-admin workflow built with Node.js, Express and SQLite.

## Payment modes
The store picks its mode automatically from the configuration:

| Configuration | Storefront button | What happens |
| --- | --- | --- |
| No iyzico keys | "Try demo order" | `test_unpaid` demo order, no money; cannot be fulfilled |
| iyzico **sandbox** keys + `PUBLIC_URL` | "Buy now" (TEST MODE note) | Real iyzico flow with test cards, no real money |
| iyzico **live** keys + `PUBLIC_URL` + `LIVE_PAYMENTS_ENABLED=true` + `PRODUCT_COMPLIANCE_VERIFIED=true` | "Buy now" | Real card payments |

Live keys without both confirmations keep checkout disabled (the server log says why). Do not accept real orders until product compliance, customer emails, final policies and deployment hardening are done.

## iyzico checkout — how payment is verified
1. `POST /api/checkout` validates the form, computes the price **server-side**, saves a `pending` order and opens an iyzico Checkout Form (`locale: en`, single installment).
2. The customer pays on iyzico's hosted page (we never see card data).
3. iyzico posts the customer's browser to `POST /api/checkout/iyzico/callback` with a token.
4. The server **retrieves the payment from iyzico's API** and marks the order `paid` only if: status `SUCCESS`, the token and basket match the order, the currency matches, and the paid amount ≥ the order total. The redirect itself is never trusted.
5. The customer lands on `/order-status.html`, which shows the status stored on the server.

Idempotent: a replayed callback does nothing more. If a customer paid but closed the browser before the callback, open the order in `/admin` and click **Verify payment with iyzico**.

### Test in sandbox
1. Create a free account at https://sandbox-merchant.iyzipay.com and copy the sandbox API key and secret key.
2. In `.env`: `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_URI=https://sandbox-api.iyzipay.com`, `PUBLIC_URL=http://localhost:3000`.
3. Restart; the log shows `Checkout: iyzico SANDBOX`. Pay with an iyzico test card (e.g. `5528 7900 0000 0008`, any future date, CVC `123`).

### Before going live with iyzico
- A real iyzico merchant account (registered business) enabled for `STORE_CURRENCY` and for foreign cards if you sell to the US.
- Confirm with iyzico the buyer identity number to send for non-Turkish buyers (`IYZICO_BUYER_IDENTITY_NUMBER`).
- Set `TRUST_PROXY=true` behind a proxy so the buyer's real IP is sent to iyzico.
- Refunds are done from the iyzico merchant panel (not in this admin yet).

## Run locally
Requirements: Node.js 20+. This store is self-contained in the `boutique/` folder of the Toumai repository (separate `package.json`, independent of the Toumai app).

```bash
cd boutique
npm install
cp .env.example .env
npm start
```
Open `http://localhost:3000`.

## Configure administrator password
Set `ADMIN_USERNAME` and generate `ADMIN_PASSWORD_HASH` using this one-time command in your terminal:

```bash
node -e "const c=require('crypto');const salt=c.randomBytes(16).toString('hex');const hash=c.scryptSync(process.argv[1],salt,64).toString('hex');console.log('scrypt$'+salt+'$'+hash)" "YOUR-STRONG-PASSWORD"
```

Copy the output into `.env` as `ADMIN_PASSWORD_HASH=...`. Choose a long, unique password. Do not commit `.env`. For production, the session store should be persistent and reviewed; this starter uses in-memory admin sessions and therefore is not appropriate for multi-instance production deployments without replacement.

## Demo order flow
1. From the storefront click “Try demo order”.
2. Enter sample information.
3. The demo order is saved as `test_unpaid` and explicitly says no payment was collected.
4. Visit `/admin` and sign in.
5. Review order details and test copying the supplier text.
6. The backend intentionally rejects supplier fulfillment/tracking for unpaid demo orders.

## Security already in place
- `/admin` and `/api/admin/*` require an admin session; `/admin.html` cannot be opened directly.
- Admin cookie `HttpOnly; SameSite=Strict` (+ `Secure` when `NODE_ENV=production`).
- Cross-origin POST requests are rejected (origin check). Set `PUBLIC_URL` and, behind a proxy, `TRUST_PROXY=true`.
- Rate limits on the API, login and demo orders. Expired sessions are purged.

## Values
- Reference supplier product cost: $27.24/unit.
- Reference shipping to customer: $15/unit.
- Reference logistics cost: $42.24/unit before fees, taxes, advertising, returns or other costs.
- Supplier has indicated 2–8 days; confirm for the actual carrier, destination and shipping method before promising this to buyers.
- Default preview price: $74.99. Change `STORE_PRICE_USD` in `.env` after market research.

## Before production — mandatory checklist
- Verify the exact heated product's safety/compliance documentation for the US market. Do not invent UL/ETL/FCC/CPSC claims or electrical safety features.
- Obtain commercial rights for supplier images. Replace generic mood imagery with accurate, authorized product photography.
- iyzico is integrated (hosted checkout + server-side verification). Complete the "Before going live with iyzico" list above and test the full flow in sandbox.
- Implement durable sessions/CSRF protection and production-grade admin auth; configure secure cookies and persistent session storage.
- Configure order confirmation, shipping and delay emails with a real mail provider.
- Review sales tax, privacy, consumer, returns, product liability and electrical-product obligations with qualified advice for the relevant jurisdictions.
- Verify delivery estimate 2–8 days for the actual US service and ZIP codes.
- Test checkout, refunds, idempotency, duplicate webhooks, rate limits, backups, monitoring and mobile accessibility.
- Remove placeholder contact email `support@example.com` and finish all policy pages.
- Configure HTTPS, production secrets, database persistence and backups on the selected host.

## Files
- `public/hero-concept.jpg`: hero mood image (generic lifestyle image — replace with authorised product photography before launch).
- `server.js`: Express API, SQLite schema (+ automatic column migrations), admin auth, demo orders, iyzico checkout and protected admin routes.
- `iyzico.js`: iyzico Checkout Form initialize / retrieve, payment verification rules, live-mode gating.
- `public/order-status.html`: page shown after payment.
- `public/index.html`: storefront.
- `public/styles.css`: visual design.
- `public/store.js`: demo order flow.
- `public/admin-login.html`, `public/admin.html`: admin UI.
- `public/policies.html`: draft policies.
- `.env.example`: environment configuration template.
- `docs/CLAUDE_NEXT_STEPS.md`: prompt/checklist for Claude Code.
