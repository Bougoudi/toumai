# Customer reviews — Phase 8: threat matrix

| Threat | Control | Evidence (test) | Status |
|---|---|---|---|
| Stored XSS in name/title/comment | Text stored verbatim, rendered with `textContent` only; no `innerHTML` in `reviews.js`; admin uses `esc()`; CSP `script-src 'self'` | R5, e2e "safe text rendering" (`window.__xss` undefined, no element created) | covered |
| SQL injection | Parameterised better-sqlite3 statements only; status filter whitelisted | code review `src/reviews.js`; R3/R9 | covered |
| Browser sets approved / verified | Server-decided fields rejected (400); status always `pending`; verification only from token + order | R4, R2, R12 | covered |
| Fake "Verified Purchase" | Single-use 256-bit token, stored hashed, e-mailed to the order address; order re-checked at submission; DB CHECK `verified ⇒ purchase_order_id` | R12 (test/unpaid/unshipped/cancelled/refunded/partially refunded/expired/reused/forged) | covered |
| Order or account enumeration | Same generic answer for every verification request; public API never returns order or e-mail | R12, R10 | covered |
| Token leak | Hash only in DB; link not stored in the e-mail log; review e-mails can't be re-sent from the log; token removed from the address bar; `Referrer-Policy: no-referrer` (helmet default); analytics paths drop query strings | R12, R14 | covered |
| Spam / flooding | 5 submissions per 15 min and 20/day per IP; honeypot; 32 kb body limit; moderation before publication | R6 (429), R4 (honeypot), R3 (413) | covered — in-memory limits (one instance) |
| Duplicates / replay | Fingerprint of normalised text per product (409); one review per verified order (unique index) | R6, R12 | covered |
| CSRF on admin actions | Session cookie + `X-CSRF-Token`; cross-origin POSTs rejected | R8 | covered |
| Privilege escalation | `requireAdmin` server-side on every admin route; role headers ignored; forged cookies refused | R8 | covered (single admin role exists) |
| Silent moderation abuse | Fixed reason categories (never "negative"); history in the same transaction; audit log | R7, R9 | covered |
| Personal data exposure | Public API returns only rating, name, title, text, date, recommend, badge; no IP or e-mail stored with reviews; erase action for removal requests | R10, R9 | covered |
| Sensitive data in logs | Errors log only method, path and stack; review bodies, e-mails and tokens are never logged; audit details strip token/password/secret keys (`summarize()`) | code review `src/app.js` | covered |
| Negative reviews blocked by anti-abuse | Anti-abuse rules look at volume and exact duplicates only, never rating or sentiment | R7 | covered |
| Distributed spam (many IPs) | Moderation queue is the backstop | — | **accepted risk**: no CAPTCHA (would need a third-party service) |
