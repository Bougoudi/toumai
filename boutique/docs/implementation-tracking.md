# Customer reviews — implementation tracking (phases 0–10)

- **Executor**: Claude Code, acting for every team role.
- **Validator** for every phase: the store owner (technical and product). **No phase has been validated by the owner yet.** "Done" below means "exit criteria met with evidence — owner validation pending".
- **Scope**: branch `ccr-32301c29-fvxd5j`, PR #52 (not merged), base `main` = `f10ec9d`.
- **Environment**: isolated container, temporary SQLite files created by the tests and deleted afterwards.
- **Production**: read-only checks only, on 2026-10-11: `GET /api/reviews` → 404, `GET /review-policy` → 404. Nothing about reviews is deployed and the production database was never migrated.

## Audit of the actual state (step 1)

| Phase | State found before this pass | Action taken in this pass |
|---|---|---|
| 0 | Architecture decision written, with evidence | Re-checked against the code; unchanged |
| 1 | Audit written | Re-checked; added the production-migration risk (B0) |
| 2 | Schema v6, constraints, indexes, rollback (R15) | **Gap**: v6 ran automatically on start, so merging would have migrated production. Fixed with `REVIEWS_ENABLED` (off by default) |
| 3 | Form, list and pagination; browser tests | Section hidden while reviews are off |
| 4 | API and validation, R2–R6 | **Gap**: no proof about logs. Added R17 |
| 5 | Verification by e-mailed link, R12–R13 | No change; blocked in production by B1 |
| 6 | Moderation and history, R8–R9 | **Gap**: no proof of atomicity. Added R18 |
| 7 | Public display, R2/R5/R7/R10, browser tests | Footer link and policy page hidden while reviews are off |
| 8 | Threat matrix | Updated with R16–R18 |
| 9 | 55 unit tests and 5 browser suites | Re-run in full: 58 unit tests, 5 browser suites |
| 10 | Not started | **Blocked**: see B0 |

## Per-phase record

Format: entry criteria → exit criteria → evidence → status. Line numbers refer to the PR #52 head after this pass.

### Phase 0 — Architecture
- **Entry criteria**: repository and branch identified (met); owner named (met: the store owner).
- **Exit criteria**: every choice classed as confirmed or unavailable, with evidence (met); owner approval (**pending**).
- **Evidence**: `docs/reviews/architecture-decision.md` (Express, SQLite/better-sqlite3, hand-written shared rules, session + CSRF, in-memory rate limits, node:test + Playwright, internal orders tables, Resend).
- **Decisions**:
  - D1: reuse the existing stack instead of Next.js, PostgreSQL, Zod or Redis.
  - D3: there is a single admin role.
- **Status**: done — owner validation pending.

### Phase 1 — Audit
- **Exit criteria**:
  - files, routes, tables and integrations identified (met);
  - no data created (met: R11 checks 0 reviews and 0 orders after loading the pages; the audit only reads files).
- **Evidence**: `docs/reviews/reviews-audit.md`; production read-only checks (404s above).
- **Status**: done — owner validation pending.

### Phase 2 — Data model and shared validation
- **Exit criteria**:
  - migration applies, rolls back and re-applies (met: R15);
  - every field has type, length and normalisation rules (met: `public/js/review-rules.js`, R1, R3);
  - constraints and indexes verified (met: R15 checks the CHECK failures and lists the indexes);
  - no data inserted (met: R16 checks the migration creates no review).
- **Production safety**:
  - `open(dbPath, { reviews })` applies v6 only when `reviews` is true (`src/db.js`, `migrate(db, target)`);
  - `server.js` passes `cfg.reviewsEnabled`;
  - `REVIEWS_ENABLED` defaults to off (`src/config.js`);
  - a newer database is never downgraded.
- **Evidence**:
  - R16 with the switch off: `user_version = 5`, no review tables, no `review_requested_at` column;
  - re-opening the same file with the switch on → v6, orders kept;
  - mutation check: forcing v6 makes R16 fail.
- **Status**: done — owner validation pending.

### Phase 3 — Frontend form and public display
- **Exit criteria**:
  - exact initial state (met);
  - no request on load (met);
  - button disabled when consent is missing, the name is invalid or the comment is invalid (met);
  - ARIA errors (met);
  - keyboard rating (met);
  - one request on double click, with controls disabled during the request (met);
  - confirmation only after a 201 (met);
  - error shown on failure (met).
- **Evidence**:
  - `test/e2e-reviews.cjs` (phone and desktop);
  - `test/e2e-product.cjs`: the section, jump link and footer link stay hidden while reviews are off.
- **Status**: done — owner validation pending.

### Phase 4 — Public submission API
- **Exit criteria**:
  - valid submissions are stored as `pending` (met: R2);
  - server-decided fields are refused (met: R4);
  - 400, 409, 413 and 429 are covered (met: R3, R6);
  - 401 and 403 do not apply: the public route needs no account (the origin check covers CSRF);
  - logs contain no sensitive data (met: R17 covers the 201, 400, 409, a forced 500 and a 429; the logs contain no name, comment, e-mail or token).
- **Status**: done — owner validation pending.

### Phase 5 — Purchase verification
- **Exit criteria**:
  - eligible, test, unpaid, unshipped, cancelled, refunded, partially refunded, expired, reused and forged cases each covered (met: R12);
  - only the eligible case returns `verified` (met);
  - the badge is shown only for `verified` (met: R10 and the browser fixture);
  - without an e-mail provider, the request is refused and nothing is claimed (met: R13).
- **Status**: **code done; blocked in production** by B1 (no e-mail provider). Decision D2 (eligibility rule) is pending.

### Phase 6 — Moderation and admin routes
- **Exit criteria**:
  - unauthenticated and forged-cookie requests → 401; missing CSRF or cross-origin → 403; a role header is ignored (met: R8);
  - allowed transitions write one history row; forbidden ones are rejected with no change (met: R9);
  - the history row is written atomically with the status change (met: R18 — when the history write fails, the status stays `pending`, there is no history row, no audit row and nothing is published).
- **Admin interface**: `/admin` → Reviews tab, shown only when reviews are enabled (browser admin test).
- **Status**: done — owner validation pending. Decision D4 (erase action) pending.

### Phase 7 — Publication rules
- **Exit criteria**:
  - only approved reviews are public (met: R2, R10; mutation check);
  - HTML is rendered as text (met: R5 and the browser `window.__xss` check);
  - the empty message is exact (met: browser test);
  - a negative review is published (met: R7);
  - the badge depends strictly on the server status (met).
- **Status**: done — owner validation pending.

### Phase 8 — Security, abuse and observability
- **Exit criteria**: every critical threat has a control and a test, or an accepted risk.
- **Evidence**: `docs/reviews/threat-matrix.md`; R4–R6, R8, R12, R17, R18.
- **Accepted risks** (pending owner acceptance):
  - R-1: no CAPTCHA;
  - R-2: rate limits are in memory.
- **Status**: done — owner validation pending.

### Phase 9 — Tests
- **Exit criteria**:
  - relevant suites run in isolation (met);
  - critical criteria covered (met);
  - no production writes (met: the tests use temporary directories and the production URL is never called with a write).
- **Evidence, run of 2026-10-11**:
  - `npm test` → **58/58 pass** (reviews R1–R18);
  - `npm run test:e2e` → **5/5 suites pass**: storefront and checkout, analytics, marketing, product, reviews.
- **Mutation checks** — each one makes the suite fail, then the code is restored:
  - approved filter removed;
  - test orders made eligible;
  - unpaid or refunded orders made eligible;
  - any transition allowed;
  - server-only fields accepted;
  - verification token reusable;
  - v6 migration forced;
  - review routes registered while reviews are off.
- **Status**: done.

### Phase 10 — Release
- **Status: BLOCKED** (B0). The phase stops here, as the instructions require.
- **Prepared**:
  - activation procedure (below);
  - rollback tested in isolation (R15: `rollbackReviews` → v5, orders kept, then v6 again);
  - with `REVIEWS_ENABLED` unset, a code-only rollback (redeploying the previous commit) is safe.

## Blockers, decisions and risks (standard format, condensed)

| ID | Phase | Type | Description | Impact | Owner | Opened | Target | Status | Next action | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| B0 | 10 | blocker (critical) | Turning reviews on in production migrates the production database to v6 — forbidden without the owner's explicit go-ahead | Reviews can't go live | Store owner | 2026-10-11 | owner's decision | open | Owner approves: (1) merge PR #52 — safe, no migration while `REVIEWS_ENABLED` is unset; (2) backup; (3) set `REVIEWS_ENABLED=true` | R16; production 404 checks |
| B1 | 5 | blocker | No e-mail provider on Render (`RESEND_API_KEY`, `EMAIL_FROM`) | No Verified Purchase badges or review requests; the site says so | Store owner | 2026-10-10 | before activation | open | Resend account, verified domain, both variables | R13 |
| B2 | 10 | blocker | Render free plan: the SQLite file is wiped on restart | Reviews and orders lost on each deploy | Store owner | 2026-10-10 | before activation | open | Starter plan + disk, `DB_PATH=/var/data/havenlume.sqlite` | README "Deploy on Render" |
| D1 | 0 | decision | Existing stack reused instead of the suggested one | none | Owner | 2026-10-10 | — | proposed | Confirm | architecture-decision.md |
| D2 | 5 | decision | Eligible order = `paid` (not partially or fully refunded), shipped or delivered, not test, cancelled or returned, contains the product | Defines who gets the badge | Owner (product) | 2026-10-10 | before activation | in progress | Confirm or change | `src/reviews.js` `isEligibleOrder` |
| D3 | 6 | deviation | Single admin role: there is no "authenticated non-admin" to test | Covered by the 401/403 tests | Owner | 2026-10-10 | — | proposed | Accept | R8 |
| D4 | 6 | decision | "Erase" action (status `hidden`, content wiped) for removal requests | Text is irreversibly removed | Owner | 2026-10-10 | — | in progress | Confirm | R9 |
| D5 | 2 | decision | `REVIEWS_ENABLED` switch, off by default | Merging no longer touches production | Owner | 2026-10-11 | — | proposed | Confirm | R16, mutation checks |
| R-1 | 8 | risk | No CAPTCHA | Spam from many IP addresses reaches the moderation queue | Owner | 2026-10-10 | — | open | Accept, or add a provider later | threat-matrix.md |
| R-2 | 8 | risk | In-memory rate limits | Weaker if several instances run | Owner | 2026-10-10 | — | proposed | Accept | `src/app.js` limiter |
| L-1 | 7 | deviation | No `aggregateRating` in JSON-LD | No stars in Google results | Owner | 2026-10-10 | later | open | Revisit once there are real approved reviews | product-facts.test.js guard |
| L-2 | 10 | risk | Review rules and privacy text not reviewed by a lawyer | Compliance not guaranteed | Owner | 2026-10-10 | before activation | open | Legal review | `/review-policy`, `/privacy` |

## Activation procedure (owner, after B0–B2)

1. Merge PR #52. While `REVIEWS_ENABLED` is unset there is no migration, no review route and no review interface (R16).
2. Admin → Settings → **Download backup** (`/api/admin/backup`).
3. On Render, set `REVIEWS_ENABLED=true`. Optionally set `RESEND_API_KEY`, `EMAIL_FROM` and `PUBLIC_URL` for Verified Purchase badges. Save; the restart runs the v6 migration.
4. Check: `GET /api/reviews` → `count: 0`; the product page shows "No reviews yet. Be the first to share your experience."; Admin → Reviews is empty.
5. Rollback: unset `REVIEWS_ENABLED` (hides everything; tables are kept); to remove the data as well, restore the backup or run `rollbackReviews(db)` (R15).

## Data created

No real review, fake review, fake order or persistent demo data was created. The form's demo state lives only in the browser and is never stored (R11). Test fixtures exist only in temporary test databases, which are deleted after each run.
