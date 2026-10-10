# Customer reviews — Phase 2: data model, statuses and API

Migration: schema **v6** in `src/db.js` (`REVIEWS_SCHEMA`), applied automatically on start.
Down-migration: `rollbackReviews(db)` (drops review tables and `orders.review_requested_at`,
sets `user_version = 5`; orders untouched). Tested in `test/reviews.test.js` R15 (apply → rollback → re-apply).

## Tables

**reviews** — `id` (internal), `public_id` (random, used publicly), `product_id`, `rating` (CHECK 1–5),
`display_name` (CHECK 2–40), `title` (NULL or ≤100), `comment` (CHECK 20–1500),
`purchased_from_havenlume` ('yes'|'no' — the customer's statement, never proof),
`would_recommend` (NULL|'yes'|'no'|'not_sure_yet'), `publication_consent` (CHECK = 1),
`moderation_status` (CHECK pending|approved|rejected|hidden, default pending),
`purchase_verification_status` (CHECK unverified|verified|ineligible, default unverified),
`purchase_order_id` (FK orders, internal only), `fingerprint` (duplicate key), `moderation_reason`,
`erased_at`, `created_at`, `updated_at`, `published_at`.
Table CHECK: `verified` requires `purchase_order_id`. Unique partial index: one review per order.
Indexes: `(product_id, moderation_status, published_at)`, `(moderation_status, created_at)`, `(product_id, fingerprint)`.

**review_moderation_history** — `review_id`, `admin_user`, `action`, `previous_status`, `new_status`, `note`, `created_at`;
written in the same transaction as the status change.

**review_tokens** — single-use links: `token_hash` (SHA-256 only), `order_id`, `purpose` (verify|request),
`expires_at` (7 / 30 days), `used_at`.

**orders.review_requested_at** — prevents sending a post-delivery request twice.

No e-mail address, IP address, postal address, password or payment data is stored in review tables.

## Field rules (shared: `public/js/review-rules.js`, used by browser and server)

| Field | Rule | Normalisation |
|---|---|---|
| rating | integer 1–5 (a string "5" is refused) | none |
| displayName | required, 2–40 characters | control/zero-width characters removed, whitespace collapsed, trimmed |
| title | optional, ≤100 | same as name; empty → NULL |
| comment | required, 20–1,500 characters | control characters removed, spaces collapsed per line, ≥3 blank lines → 1 |
| purchasedFromHavenLume | 'yes' or 'no' | — |
| wouldRecommend | optional: 'yes', 'no', 'not_sure_yet' | — |
| publicationConsent | must be boolean `true` | — |
| verificationToken | optional, 43-char base64url issued by the server | — |
| website | honeypot, must be empty | — |
Characters are counted as Unicode code points (an emoji counts as 1).
Any other field → 400; server-decided fields (status, approved, verifiedPurchase, purchase_order_id…) → 400.

## Moderation transitions (`TRANSITIONS` in `src/reviews.js`)

| Action | From | To | Reason |
|---|---|---|---|
| approve | pending, hidden | approved | none (sets `published_at` once) |
| reject | pending | rejected | required |
| hide | approved, rejected | hidden | required |
| erase | any (not already erased) | hidden + content wiped | required |
Anything else → 409 with no change and no history row. Reasons are content categories
(spam, offensive, personal_info, off_topic, conflict_of_interest, duplicate, customer_request, other+note);
"negative" is not a reason. No route edits text, rating or verification.

## API

| Method & path | Access | Result |
|---|---|---|
| `GET /api/reviews?productId=&page=` | public | approved reviews only, public fields only, summary (count, average, distribution), 10 per page |
| `POST /api/reviews` | public, origin-checked, 5 per 15 min + 20/day per IP | 201 pending · 400 invalid · 409 duplicate / order already reviewed · 413 too large · 429 |
| `POST /api/reviews/verification-request` | public, 5/hour per IP | same generic answer whether or not the order exists · 503 without e-mail provider |
| `GET /api/reviews/verification?token=` | public | `{ valid }` only |
| `GET /api/admin/reviews?status=` | admin | queue with counts and reasons |
| `POST /api/admin/reviews/:id/{approve,reject,hide,erase}` | admin + CSRF | controlled transition + history + audit |
| `GET /api/admin/reviews/:id/moderation-history` | admin | history |
| `POST /api/admin/orders/:id/review-request` | admin + CSRF | 200 sent · 409 no provider / not delivered / refunded / already sent · 502 provider failure |
