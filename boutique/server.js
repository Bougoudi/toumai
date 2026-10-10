// HavenLume store entry point.
require("dotenv").config();
const { load } = require("./src/config");
const { open } = require("./src/db");
const { createApp } = require("./src/app");
const iyzico = require("./src/iyzico");
const auth = require("./src/auth");
const backup = require("./src/backup");

const cfg = load();
const db = open(cfg.dbPath);
const app = createApp({ cfg, db });

backup.schedule(db, cfg);
setInterval(() => auth.purgeExpired(db), 15 * 60_000).unref();

app.listen(cfg.port, () => {
  const s = iyzico.checkoutStatus(cfg);
  console.log(`${cfg.storeName} running on port ${cfg.port}. Checkout: ${s.enabled ? `iyzico ${s.mode.toUpperCase()}` : `demo only (${s.reason})`}. Email: ${cfg.email.resendApiKey && cfg.email.from ? "Resend" : "not configured (emails are prepared, not sent)"}.`);
  if (!cfg.adminPasswordHash) console.warn("ADMIN_PASSWORD_HASH is not set: the admin is locked.");
});
