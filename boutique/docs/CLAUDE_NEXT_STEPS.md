# Prompt to continue in Claude Code

Open this project and audit it before editing. This starter uses Node.js, Express and SQLite. Keep the existing responsive visual design, but do not claim it is production ready.

1. Inspect every file and run npm install / npm start if the environment allows.
2. Fix any bugs found; verify the demo order flow and admin login. Do not silently remove the intentional unpaid-order guard.
3. Improve server security, including CSRF/origin controls where appropriate, durable session storage, and secure deployment configuration.
4. Implement a real hosted checkout only after the owner chooses a provider that supports the owner's real country and payout situation. Verify official provider docs. Never simulate payment success. Verify webhook signatures and idempotency.
5. Do not mark an order paid based on browser redirects. Only verified provider events can set payment_status=paid.
6. Add real transactional emails for paid order, shipment and delay using a configured provider; don't pretend email was sent if not configured.
7. Ensure admin can copy supplier shipping details, save actual supplier cost, and tracking, but only fulfill truly paid orders.
8. Confirm whether the 2–8 day delivery estimate is substantiated for the actual service and destination before displaying as a promise.
9. Keep live payments disabled until the exact heated product's applicable US safety/compliance documentation has been reviewed. Never invent certification claims.
10. Run and report tests, list environment variables, migrations, deployment steps, and remaining blockers. Do not deploy to production or enable live payments while required secrets or compliance confirmations are missing.
