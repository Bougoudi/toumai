// E-mail list with a real welcome code.
// - Signing up stores the e-mail address, where it was given and the consent text shown. No IP address.
// - The welcome promo lives in the promotions table and is (re)created at start-up from the
//   configuration, so a database reset never leaves subscribers with a dead code.
// - The welcome code works once, and only for an e-mail address that is subscribed: this is checked
//   server-side when the order is created (orders.createOrder), never trusted from the browser.
// - Without an e-mail provider nothing is sent and nothing claims it was: the code is shown on screen.
const crypto = require("crypto");
const promotions = require("./promotions");
const notify = require("./notify");

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SOURCES = ["popup", "cart", "footer"];
const CONSENT_TEXT = "Marketing emails from HavenLume (launch news, care tips and offers). Unsubscribe anytime.";

class NewsletterError extends Error { constructor(status, message) { super(message); this.status = status; } }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed','unsubscribed')),
  source TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  unsubscribe_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unsubscribed_at TEXT
);`;

/** Additive only: creates the table if it is missing. Never alters or drops anything. */
function ensureSchema(db) { db.exec(SCHEMA); }

const isWelcome = (cfg, code) => Boolean(code) && promotions.normCode(code) === cfg.newsletter.welcomeCode;

/** Creates or refreshes the welcome promotion from the configuration. */
function ensureWelcomePromo(db, cfg) {
  const n = cfg.newsletter;
  const t = now();
  const existing = db.prepare("SELECT id FROM promotions WHERE code=?").get(n.welcomeCode);
  const description = "Newsletter welcome code — one use per subscribed email (managed by NEWSLETTER_* settings)";
  if (existing) {
    db.prepare("UPDATE promotions SET description=?, kind='percent', value=?, min_subtotal_cents=0, ends_at=?, max_redemptions=NULL, active=1, updated_at=? WHERE id=?")
      .run(description, n.welcomePercent, n.welcomeEndsAt, t, existing.id);
  } else {
    db.prepare(`INSERT INTO promotions(code,description,kind,value,min_subtotal_cents,starts_at,ends_at,max_redemptions,active,created_at,updated_at)
      VALUES(?,?,'percent',?,0,?,?,NULL,1,?,?)`).run(n.welcomeCode, description, n.welcomePercent, "2026-10-01T00:00:00.000Z", n.welcomeEndsAt, t, t);
  }
}

function welcomeConditions(cfg) {
  const p = { kind: "percent", value: cfg.newsletter.welcomePercent, min_subtotal_cents: 0, ends_at: cfg.newsletter.welcomeEndsAt, max_redemptions: null };
  return `${promotions.describe(p)} One use per subscribed email address, checked at payment.`;
}

/** Throws unless this e-mail may use the welcome code on a new order. */
function assertWelcomeAllowed(db, cfg, email) {
  const e = String(email || "").trim().toLowerCase();
  const sub = db.prepare("SELECT status FROM newsletter_subscribers WHERE email=?").get(e);
  if (!sub || sub.status !== "subscribed") {
    throw new promotions.PromoError(`The code ${cfg.newsletter.welcomeCode} is reserved for newsletter subscribers. Use the email address you subscribed with.`);
  }
  const used = db.prepare(`SELECT COUNT(*) n FROM orders WHERE promo_code=? AND lower(customer_email)=? AND is_test=0
    AND payment_status IN ('paid','partially_refunded','refunded')`).get(cfg.newsletter.welcomeCode, e).n;
  if (used > 0) throw new promotions.PromoError(`The code ${cfg.newsletter.welcomeCode} has already been used with this email address.`);
}

/** Subscribes (or re-subscribes) an address. Same answer whether it was new or not. */
async function subscribe(db, cfg, body) {
  if (!body || typeof body !== "object") throw new NewsletterError(400, "Invalid request.");
  if (body.website) throw new NewsletterError(400, "Your sign-up could not be accepted."); // honeypot
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new NewsletterError(400, "Enter a valid email address.");
  const source = SOURCES.includes(body.source) ? body.source : "footer";
  const token = crypto.randomBytes(24).toString("base64url");
  const t = now();
  const existing = db.prepare("SELECT * FROM newsletter_subscribers WHERE email=?").get(email);
  if (existing) {
    db.prepare("UPDATE newsletter_subscribers SET status='subscribed', unsubscribe_hash=?, consent_text=?, updated_at=?, unsubscribed_at=NULL WHERE id=?")
      .run(sha256(token), CONSENT_TEXT, t, existing.id);
  } else {
    db.prepare("INSERT INTO newsletter_subscribers(email,status,source,consent_text,unsubscribe_hash,created_at,updated_at) VALUES(?,'subscribed',?,?,?,?,?)")
      .run(email, source, CONSENT_TEXT, sha256(token), t, t);
  }
  let emailed = false;
  if (notify.emailConfigured(cfg) && cfg.publicUrl) {
    const link = `${cfg.publicUrl}/newsletter/unsubscribe?token=${token}`;
    const lines = [
      "Thanks for joining the HavenLume list.", "",
      `Your welcome code: ${cfg.newsletter.welcomeCode}`, welcomeConditions(cfg), "",
      "We'll write occasionally with launch news, care tips and offers.", "",
      `Unsubscribe anytime: %LINK%`,
      ...(cfg.businessName || cfg.businessAddress ? ["", [cfg.businessName, cfg.businessAddress].filter(Boolean).join(", ")] : []),
    ].join("\n");
    const sent = await notify.sendNow(db, cfg, { kind: "newsletter_welcome", to: email, subject: `Welcome to ${cfg.storeName} — your ${cfg.newsletter.welcomePercent}% code`,
      body: lines.replace("%LINK%", link), storedBody: lines.replace("%LINK%", "[unsubscribe link — not stored]") });
    emailed = sent.status === "sent";
  }
  return { subscribed: true, code: cfg.newsletter.welcomeCode, percent: cfg.newsletter.welcomePercent, conditions: welcomeConditions(cfg), emailed };
}

function unsubscribe(db, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) return false;
  const r = db.prepare("UPDATE newsletter_subscribers SET status='unsubscribed', unsubscribed_at=?, updated_at=? WHERE unsubscribe_hash=? AND status='subscribed'")
    .run(now(), now(), sha256(token));
  return r.changes === 1;
}

// ---------------------------------------------------------------- admin
function adminList(db, cfg) {
  const rows = db.prepare("SELECT id,email,status,source,created_at,unsubscribed_at FROM newsletter_subscribers ORDER BY id DESC LIMIT 1000").all();
  const counts = db.prepare("SELECT status s, COUNT(*) n FROM newsletter_subscribers GROUP BY status").all().reduce((a, r) => ({ ...a, [r.s]: r.n }), { subscribed: 0, unsubscribed: 0 });
  const used = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(discount_cents),0) c FROM orders WHERE promo_code=? AND is_test=0
    AND payment_status IN ('paid','partially_refunded','refunded')`).get(cfg.newsletter.welcomeCode);
  return { counts, code: cfg.newsletter.welcomeCode, percent: cfg.newsletter.welcomePercent, codeUses: used.n, codeDiscountCents: used.c, subscribers: rows };
}

const csvCell = (v) => {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function exportCsv(db) {
  const rows = db.prepare("SELECT email,status,source,created_at,unsubscribed_at FROM newsletter_subscribers ORDER BY id").all();
  return ["email,status,source,subscribed_at,unsubscribed_at", ...rows.map(r => [r.email, r.status, r.source, r.created_at, r.unsubscribed_at].map(csvCell).join(","))].join("\n") + "\n";
}

function remove(db, id) {
  const r = db.prepare("DELETE FROM newsletter_subscribers WHERE id=?").run(id);
  if (r.changes !== 1) throw new NewsletterError(404, "Subscriber not found.");
}

module.exports = { NewsletterError, CONSENT_TEXT, ensureSchema, ensureWelcomePromo, isWelcome, welcomeConditions, assertWelcomeAllowed, subscribe, unsubscribe, adminList, exportCsv, remove };
