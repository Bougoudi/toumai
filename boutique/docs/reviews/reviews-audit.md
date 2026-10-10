# Customer reviews — Phase 1: repository audit

Audited at commit `f10ec9d` (before any review code). Environment: isolated container, temporary
SQLite files only; the production database on Render was never accessed.

## Inventory (what existed and was reused)

| Area | Found | Evidence | Reused for reviews |
|---|---|---|---|
| Product page | Static page + script | `public/product.html`, `public/js/product.js` | New `#reviews` section, `public/js/reviews.js` |
| DOM rendering | `HL.el()` sets text with `textContent` | `public/js/common.js:33-40` | All review text rendered through it (no `innerHTML`) |
| Admin UI | Tabbed SPA, `api()`/`post()` with CSRF header, `esc()` | `public/js/admin.js` | New "Reviews" tab, review request card in the order drawer |
| Routes | Express, all in `createApp()` | `src/app.js` | `/api/reviews*`, `/api/admin/reviews*` |
| Admin auth | Hashed session cookie + CSRF token, one admin account | `src/auth.js:51-82` | `requireAdmin` on every admin review route |
| CSRF / origin | Cross-origin POSTs rejected | `src/app.js:56-64` | Applies to the public review POST too |
| Rate limiting | express-rate-limit, in-memory | `src/app.js:66-67` | Per-route limits on submission and link requests |
| Body size | `express.json({ limit: "32kb" })` | `src/app.js:51` | Oversized review → 413 |
| CSP | `script-src 'self'`, no inline scripts | `src/app.js:34-50` | Blocks injected inline scripts as a second layer |
| Database | SQLite, `user_version` migrations, FK ON | `src/db.js` | Schema v6 |
| Orders | `orders` (payment/fulfillment status, `is_test`), `order_items` (`sku`) | `src/db.js` | Purchase eligibility |
| E-mail | Resend, `emailConfigured()`; prepared-not-sent when absent | `src/notify.js` | `sendNow()` added: link sent, stored copy redacted |
| Audit trail | `audit_log` + `order_events` | `src/auth.js:36`, `src/orders.js` | Every moderation action + review requests |
| Analytics | Allow-listed events only | `src/analytics.js:16` | Untouched (no review event added) |

## Gaps found (all recorded in `implementation-tracking.md`)

1. No review feature, table or route existed.
2. No customer accounts → the only reliable customer↔order link is the order's e-mail address.
3. No e-mail provider configured in production (`RESEND_API_KEY`, `EMAIL_FROM` empty) → verification
   and review requests can't run there yet.
4. No Redis → rate limits are per process (acceptable on one Render instance).
5. One admin role only → no "authenticated non-admin" user exists to test against.
6. No Zod / TypeScript / Testing Library → shared plain-JS rules file, node:test + Playwright.
7. Product JSON-LD has no rating; none is added (see limitations).

## Data created during the audit

None. The audit only read files. Tests create temporary databases under the OS temp directory and
delete them; `R11` asserts that loading pages writes nothing and that no demo reviews or orders exist.
