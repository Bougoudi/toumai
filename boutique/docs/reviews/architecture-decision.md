# Customer reviews — Phase 0: architecture decision

Base commit audited: `f10ec9d` (main after PR #51). Branch: `ccr-32301c29-fvxd5j`.
Rule followed: reuse what the repository already uses; never assume an integration exists.

| Choice | Proposed in the plan | Status | What the repo actually uses (evidence) | Decision |
|---|---|---|---|---|
| Frontend | Next.js / React + TypeScript | **unavailable** for the store | Static HTML in `public/*.html` + plain scripts `public/js/*.js`, no build step (`package.json` scripts) | Reuse: plain JS, `HL.el()` DOM builder (`public/js/common.js:33`) — text is always set with `textContent`, never HTML |
| Backend | Existing server routes | **confirmed** | Express 4 (`package.json`), all routes in `src/app.js` | Add `/api/reviews*` and `/api/admin/reviews*` there; domain logic in a new `src/reviews.js` like `src/orders.js` |
| Database / ORM | PostgreSQL + Prisma/Drizzle | **unavailable** | SQLite through better-sqlite3, migrations versioned with `PRAGMA user_version` (`src/db.js:6`, `src/db.js:24`), foreign keys ON (`src/db.js:19`) | SQLite schema v6 with CHECK constraints and indexes; a tested `rollbackReviews()` provides the down-migration |
| Validation | Zod | **unavailable** (not a dependency) | Hand-written validators (`src/orders.js` `validateCheckout`) | One shared rules file `public/js/review-rules.js`, loaded by the browser and `require()`d by the server — same limits on both sides |
| Admin auth & role | Server-side admin role | **confirmed** (single role) | Cookie session stored as a hash + CSRF header (`src/auth.js:51`, `src/auth.js:69-82`); there is one admin account and no non-admin user type | `requireAdmin` on every admin route. "Authenticated non-admin" does not exist in this store: covered by tests for no session (401), forged cookie (401), missing CSRF (403), cross-origin (403) |
| CSRF | — | **confirmed** | Origin check on all non-GET requests (`src/app.js:56-64`) + CSRF token for admin | Reused for the public review POST |
| Rate limiting / anti-replay | Redis | **Redis unavailable**; express-rate-limit **confirmed** | `limiter()` helper, in-memory store (`src/app.js:66-67`) | In-memory limits (one Render instance). Duplicate protection is persistent (SQLite fingerprint) |
| Tests | Vitest/Jest, Testing Library, Playwright | node:test + Playwright **confirmed**; Vitest/Testing Library **unavailable** | `npm test`, `npm run test:e2e` (`package.json`) | Unit/API tests with node:test, browser/accessibility tests with Playwright |
| Purchase source of truth | Internal tables or e-commerce API | **confirmed: internal** | `orders` + `order_items` tables (`src/db.js`), payment verified with iyzico before `paid` | Verification by **single-use link e-mailed to the order address** (no customer accounts exist) |
| E-mail | — | **code confirmed, provider not configured in production** | Resend via `src/notify.js` (`emailConfigured()`); `RESEND_API_KEY`/`EMAIL_FROM` empty on Render | Purchase verification and review requests are refused (409, nothing sent, nothing claimed) until configured |
| Observability | — | **minimal** | `log` object passed to `createApp`, audit table `audit_log` (`src/auth.js:36`) | Moderation history table + audit log; review text, e-mails and tokens are never logged |

Hypotheses not verifiable from the repository are tracked in `implementation-tracking.md`.
Approval: owner (technical + product) — pending, see tracking.
