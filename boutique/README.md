# HavenLume Boutique Starter

A responsive storefront and an initial order-admin workflow built with Node.js, Express and SQLite.

## Important limits
This is a **starter project**, not a production-ready payment integration. It does not charge customers. The storefront's order modal creates clearly marked `test_unpaid` demo orders only. The admin refuses to mark those demo orders as sent to a supplier or shipped. Do not accept real orders until a real payment provider, verified webhook, product compliance review, customer email flow, final policies and deployment hardening have been implemented and tested.

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
- Choose a payment provider that accepts the seller's real country/legal setup and supports payout to the seller. Implement official hosted checkout and signed webhooks. Never treat a browser redirect as payment proof.
- Implement durable sessions/CSRF protection and production-grade admin auth; configure secure cookies and persistent session storage.
- Configure order confirmation, shipping and delay emails with a real mail provider.
- Review sales tax, privacy, consumer, returns, product liability and electrical-product obligations with qualified advice for the relevant jurisdictions.
- Verify delivery estimate 2–8 days for the actual US service and ZIP codes.
- Test checkout, refunds, idempotency, duplicate webhooks, rate limits, backups, monitoring and mobile accessibility.
- Remove placeholder contact email `support@example.com` and finish all policy pages.
- Configure HTTPS, production secrets, database persistence and backups on the selected host.

## Files
- `public/hero-concept.jpg`: hero mood image (generic lifestyle image — replace with authorised product photography before launch).
- `server.js`: Express API, SQLite schema, admin auth, demo orders and protected admin routes.
- `public/index.html`: storefront.
- `public/styles.css`: visual design.
- `public/store.js`: demo order flow.
- `public/admin-login.html`, `public/admin.html`: admin UI.
- `public/policies.html`: draft policies.
- `.env.example`: environment configuration template.
- `docs/CLAUDE_NEXT_STEPS.md`: prompt/checklist for Claude Code.
