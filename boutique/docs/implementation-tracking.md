# Customer reviews — implementation tracking

Executor: Claude Code (single engineer standing in for every team). Validator for every phase:
**the store owner** (technical + product). No phase has been signed off by the owner yet; each
row below says "pending owner validation" where a human decision is needed.
Base commit `f10ec9d`; work on branch `ccr-32301c29-fvxd5j`. Commands run in an isolated container
with temporary databases; production was never written.

## Phase summary

| Phase | Deliverables | Exit criteria | Evidence | Status |
|---|---|---|---|---|
| 0 Architecture | `docs/reviews/architecture-decision.md` | every choice classed confirmed / unavailable with evidence | that file | done — pending owner validation |
| 1 Audit | `docs/reviews/reviews-audit.md` | files, routes, tables, integrations identified; no data created | that file; R11 | done — pending owner validation |
| 2 Data model | schema v6, `rollbackReviews`, shared rules, `docs/reviews/data-model.md` | migration applies, rolls back, re-applies; constraints and indexes verified | R15, R1 | done |
| 3 Frontend | `public/product.html` `#reviews`, `public/js/reviews.js`, `public/js/review-rules.js`, CSS | exact initial state; no request on load; disabled when invalid; ARIA errors; one request on double click; confirmation only after 201 | `test/e2e-reviews.cjs` (phone + desktop) | done |
| 4 Public API | `POST /api/reviews` | 201 pending; server fields refused; 400/409/413/429 covered | R2–R6 | done (401/403 not applicable: public route needs no account) |
| 5 Purchase verification | token flow, `isEligibleOrder` | only eligible order → verified; all other cases unverified/ineligible; no simulated success | R12, R13 | done in code — **blocked in production** until e-mail is configured (B1) |
| 6 Moderation | admin routes, Reviews tab, history | 401 without session, 401 forged, 403 without CSRF / cross-origin; allowed transitions + one history row; forbidden transitions rejected | R8, R9, e2e admin | done (no non-admin role exists — D3) |
| 7 Publication | filtered public query, safe rendering, empty message | only approved returned; HTML shown as text; exact empty text; negative review visible; badge only for verified | R2, R5, R7, R10, e2e | done |
| 8 Security | `docs/reviews/threat-matrix.md` | every critical threat has a control and a test or accepted risk | threat matrix; mutation checks | done — one accepted risk (R-1) pending owner acceptance |
| 9 Tests | unit/API + browser suites | critical criteria covered; no production writes | `npm test` 55/55, `npm run test:e2e` 5 suites green; mutation checks | done |
| 10 Release | this file, README, checklist below | blockers have owner + decision | below | **waiting for owner decisions** |

## Open items (standard format, condensed)

| ID | Phase | Type | Description | Impact | Owner | Opened | Target | Status | Next action |
|---|---|---|---|---|---|---|---|---|---|
| B1 | 5 | blocage | No e-mail provider on Render (`RESEND_API_KEY`, `EMAIL_FROM` empty) | No Verified Purchase badges and no review requests in production; the site says so | Store owner | 2026-10-10 | before launch | ouvert | Create a Resend account, verify the sending domain, set both variables |
| B2 | 10 | blocage | Render free plan: SQLite is wiped on restart | Reviews (and orders) are lost on each deploy/restart | Store owner | 2026-10-10 | before launch | ouvert | Starter plan + persistent disk, `DB_PATH=/var/data/havenlume.sqlite` |
| D1 | 0 | décision | Plan suggested Next.js/PostgreSQL/Zod/Redis; repo uses static JS/SQLite/Express | None — reused existing stack | Owner | 2026-10-10 | — | accepté (proposé) | Owner confirms |
| D2 | 5 | décision | Eligible order = paid (not partially/fully refunded), shipped or delivered, not test/cancelled/returned, contains the product | Defines who gets the badge | Owner (product) | 2026-10-10 | before launch | en cours | Owner confirms the rule |
| D3 | 6 | écart | Only one admin account exists; "authenticated non-admin" can't be tested | Covered by 401/403 tests instead | Owner | 2026-10-10 | — | accepté (proposé) | — |
| D4 | 6 | décision | Added "erase" (content wiped, hidden) for removal requests / personal data, beyond the 4 statuses | Status stays one of the 4; text is gone | Owner | 2026-10-10 | — | en cours | Owner confirms |
| R-1 | 8 | risque | No CAPTCHA: distributed spam from many IPs reaches the moderation queue | Moderation workload | Owner | 2026-10-10 | — | ouvert | Accept, or add a CAPTCHA provider later |
| R-2 | 8 | risque | Rate limits are in memory (reset on restart, per instance) | Weaker limits if scaled to several instances | Owner | 2026-10-10 | — | accepté (proposé) | Revisit if more than one instance |
| L-1 | 7 | écart | No `aggregateRating` in product JSON-LD | No stars in Google results | Owner | 2026-10-10 | later | ouvert | Add once there are real approved reviews and Google's review-snippet rules are checked |
| L-2 | 10 | risque | Review rules and privacy text not reviewed by a lawyer (FTC Consumer Review Rule, state privacy laws) | Compliance not guaranteed | Owner | 2026-10-10 | before launch | ouvert | Legal review |

## Evidence of test runs (latest)

- `npm test` → 55 tests, 55 pass (reviews: R1–R15).
- `npm run test:e2e` → e2e.cjs, e2e-analytics.cjs, e2e-marketing.cjs, e2e-product.cjs, e2e-reviews.cjs all pass.
- Mutation checks (each must make the review tests fail, then code restored): public list without the
  `approved` filter, test orders eligible, unpaid/refunded orders eligible, any transition allowed,
  server-only fields accepted, reusable token → every one failed the suite.
- No demo review, fake order or seed data is created by the application; tests use temporary databases
  that are deleted afterwards (R11 asserts zero reviews and orders after page loads).

## Release checklist

- [ ] Owner validates phases 0–10 and decisions D1–D4, accepts or rejects R-1/R-2.
- [ ] B1: Resend configured (`RESEND_API_KEY`, `EMAIL_FROM`), `PUBLIC_URL` set.
- [ ] B2: persistent disk + `DB_PATH`.
- [ ] Legal review of `/review-policy` and `/privacy` (L-2).
- [ ] After deploy: `GET /api/reviews` returns `count: 0`; the product page shows the empty message.
- Rollback: redeploy the previous commit; to drop review data, run `rollbackReviews(db)` (tested in R15).
  Older code ignores the v6 tables, so a code rollback alone is safe.
