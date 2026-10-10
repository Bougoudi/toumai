// HavenLume store entry point.
require("dotenv").config();
const { load } = require("./src/config");
const { open } = require("./src/db");
const { createApp } = require("./src/app");
const iyzico = require("./src/iyzico");
const auth = require("./src/auth");
const backup = require("./src/backup");
const geoip = require("./src/geoip");
const analytics = require("./src/analytics");

const cfg = load();
const db = open(cfg.dbPath);
const app = createApp({ cfg, db });

backup.schedule(db, cfg);
setInterval(() => auth.purgeExpired(db), 15 * 60_000).unref();
// Country estimates: load (and refresh monthly) the DB-IP Lite database in the background.
if (cfg.analytics.enabled) {
  geoip.init(cfg);
  setInterval(() => geoip.init(cfg), 7 * 86400_000).unref();
  const purge = () => { try { analytics.purge(db, cfg); } catch (e) { console.error("Analytics purge failed:", e.message); } };
  purge(); setInterval(purge, 86400_000).unref();
}

app.listen(cfg.port, () => {
  const s = iyzico.checkoutStatus(cfg);
  console.log(`${cfg.storeName} running on port ${cfg.port}. Checkout: ${s.enabled ? `iyzico ${s.mode.toUpperCase()}` : `demo only (${s.reason})`}. Email: ${cfg.email.resendApiKey && cfg.email.from ? "Resend" : "not configured (emails are prepared, not sent)"}.`);
  if (!cfg.adminPasswordHash) console.warn("ADMIN_PASSWORD_HASH is not set: the admin is locked.");
});
