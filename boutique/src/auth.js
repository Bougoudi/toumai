// Admin authentication: scrypt password hash, server-side sessions stored in SQLite
// (only a SHA-256 of the token is stored), per-session CSRF token, audit log.
const crypto = require("crypto");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || "")); const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  return safeEqual(crypto.scryptSync(String(password), salt, 64).toString("hex"), hash);
}

function cookieName(cfg) { return cfg.production ? "__Host-hl_admin" : "hl_admin"; }

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

function audit(db, actor, action, target, details, ip) {
  db.prepare("INSERT INTO audit_log(actor,action,target,details,ip,created_at) VALUES(?,?,?,?,?,?)")
    .run(actor, action, target ? String(target) : null, details ? String(details).slice(0, 1000) : null, ip || null, nowIso());
}

function createSession(db, cfg, req, res) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const t = Date.now();
  db.prepare("INSERT INTO admin_sessions(token_hash,csrf_token,username,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?,?)")
    .run(sha256(token), csrf, cfg.adminUsername, t, t + cfg.sessionHours * 3600_000, req.ip, String(req.headers["user-agent"] || "").slice(0, 200));
  res.setHeader("Set-Cookie", `${cookieName(cfg)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cfg.sessionHours * 3600}${cfg.production ? "; Secure" : ""}`);
  return csrf;
}

function getSession(db, cfg, req) {
  const token = parseCookies(req)[cookieName(cfg)];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = db.prepare("SELECT * FROM admin_sessions WHERE token_hash=?").get(sha256(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(s.token_hash); return null; }
  return s;
}

function destroySession(db, cfg, req, res) {
  const token = parseCookies(req)[cookieName(cfg)];
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(sha256(token));
  res.setHeader("Set-Cookie", `${cookieName(cfg)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cfg.production ? "; Secure" : ""}`);
}

function purgeExpired(db) { db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now()); }

/** Server-side guard for every admin route. State-changing calls also need the CSRF token. */
function requireAdmin(db, cfg) {
  return (req, res, next) => {
    const s = getSession(db, cfg, req);
    if (!s) {
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Administrator authentication required." });
      return res.redirect("/admin-login.html");
    }
    if (!["GET", "HEAD"].includes(req.method) && !safeEqual(req.get("x-csrf-token"), s.csrf_token)) {
      return res.status(403).json({ error: "Invalid or missing CSRF token. Reload the page." });
    }
    req.admin = { username: s.username, csrf: s.csrf_token };
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createSession, getSession, destroySession, purgeExpired, requireAdmin, audit, safeEqual, parseCookies };
