// SQLite backups (online, consistent) with rotation.
const fs = require("fs");
const path = require("path");

async function backupNow(db, cfg) {
  fs.mkdirSync(cfg.backupDir, { recursive: true });
  const file = path.join(cfg.backupDir, `havenlume-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  await db.backup(file);
  const old = fs.readdirSync(cfg.backupDir).filter(f => /^havenlume-.*\.sqlite$/.test(f)).sort().reverse().slice(cfg.backupKeep);
  for (const f of old) fs.rmSync(path.join(cfg.backupDir, f), { force: true });
  return file;
}

function schedule(db, cfg, log = console) {
  const run = () => backupNow(db, cfg).then(f => log.log(`Backup written: ${path.basename(f)}`)).catch(e => log.error("Backup failed:", e.message));
  const first = setTimeout(run, 60_000); first.unref();
  const every = setInterval(run, 24 * 3600_000); every.unref();
}

module.exports = { backupNow, schedule };
