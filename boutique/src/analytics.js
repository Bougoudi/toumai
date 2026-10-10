// First-party, cookieless analytics.
//
// Privacy design (no cookies, no device storage for tracking, no personal data):
// - A visitor is a SHA-256 of a DAILY random salt + IP + user agent. The salt is deleted
//   the next day, so visits can't be linked across days or back to a person.
// - The IP address is only used in memory to compute that hash and to estimate the
//   country (DB-IP Lite); it is never written to the database or logs.
// - Only whitelisted event names and properties are accepted; paths lose their query
//   string. Names, emails, addresses and order numbers never enter analytics.
// - Global Privacy Control (Sec-GPC) and Do Not Track are honoured server-side too.
// - "purchase" is recorded only by the server, after iyzico has confirmed the payment.
const crypto = require("crypto");
const geoip = require("./geoip");

const CLIENT_EVENTS = new Set(["view_item", "add_to_cart", "begin_checkout", "add_payment_info"]);
const FUNNEL = ["view_item", "add_to_cart", "begin_checkout", "add_payment_info", "purchase"];
const PROP_KEYS = { item_id: "id", variant: "id", quantity: "int", value: "money", currency: "currency" };
const SESSION_GAP_MS = 30 * 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|pagespeed|headless|phantom|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|monitor|uptime/i;

// ---------------------------------------------------------------- time helpers
function parts(ts, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(new Date(ts)).map(p => [p.type, p.value]));
  return { day: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) };
}
const dayOf = (ts, tz) => parts(ts, tz).day;

/** UTC instant (ms) of 00:00 local time on `day` in `tz`. */
function startOfDayUtc(day, tz) {
  const [y, m, d] = day.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).reduce((a, x) => (a[x.type] = x.value, a), {});
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess -= local - Date.UTC(y, m - 1, d);
  }
  return guess;
}
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = (s) => Date.UTC(...s.split("-").map((v, i) => i === 1 ? v - 1 : +v));
  return Math.round((t(b) - t(a)) / 86400_000);
}

class RangeError400 extends Error { constructor(m) { super(m); this.status = 400; } }

/** Resolves ?range=today|7d|30d|custom&from&to into inclusive local days. */
function resolveRange(q, tz, now = Date.now()) {
  const today = dayOf(now, tz);
  const range = String(q.range || "7d");
  if (range === "today") return { range, from: today, to: today };
  if (range === "7d") return { range, from: addDays(today, -6), to: today };
  if (range === "30d") return { range, from: addDays(today, -29), to: today };
  if (range === "custom") {
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
    if (!ok(q.from) || !ok(q.to)) throw new RangeError400("Custom range needs valid from and to dates (YYYY-MM-DD).");
    if (q.from > q.to) throw new RangeError400("The start date must be before the end date.");
    if (q.to > today) throw new RangeError400("The end date can't be in the future.");
    if (daysBetween(q.from, q.to) > 365) throw new RangeError400("Choose a range of at most 366 days.");
    return { range, from: q.from, to: q.to };
  }
  throw new RangeError400("Unknown range.");
}

// ---------------------------------------------------------------- sanitising
function cleanPath(p) {
  let s = String(p || "");
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  s = s.split(/[?#]/)[0].slice(0, 120);
  if (!/^[A-Za-z0-9/_.-]*$/.test(s)) return null;           // drops anything that could carry data (@, %, spaces…)
  if (/^\/(admin|api)(\/|\.|$)/i.test(s) || s.startsWith("/admin-login")) return null;
  s = s.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
  return s.length > 1 ? s.replace(/\/$/, "") : s;
}

function cleanReferrer(r, ownHost) {
  try {
    const u = new URL(String(r || ""));
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === String(ownHost || "").toLowerCase().replace(/^www\./, "").split(":")[0]) return null;
    return host.slice(0, 100);
  } catch { return null; }
}

/** Keeps only whitelisted, non-personal properties with strict formats. */
function cleanProps(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const [k, kind] of Object.entries(PROP_KEYS)) {
    const v = d[k];
    if (v === undefined || v === null) continue;
    if (kind === "id" && typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v)) out[k] = v;
    if (kind === "int" && Number.isInteger(v) && v > 0 && v <= 100) out[k] = v;
    if (kind === "money" && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000) out[k] = Math.round(v * 100) / 100;
    if (kind === "currency" && v === "USD") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------- collection
function saltFor(db, day) {
  const row = db.prepare("SELECT salt FROM analytics_salts WHERE day=?").get(day);
  if (row) return row.salt;
  const salt = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR IGNORE INTO analytics_salts(day,salt) VALUES(?,?)").run(day, salt);
  db.prepare("DELETE FROM analytics_salts WHERE day < ?").run(day); // yesterday's salt is destroyed
  return db.prepare("SELECT salt FROM analytics_salts WHERE day=?").get(day).salt;
}

/**
 * Handles a beacon from the storefront. Returns the reason when nothing is recorded
 * (used by tests); the HTTP answer is always 204.
 */
function collect(db, cfg, req, isAdmin) {
  if (!cfg.analytics.enabled) return "disabled";
  if (req.get("sec-gpc") === "1" || req.get("dnt") === "1") return "opted_out";
  const ua = String(req.get("user-agent") || "");
  if (!ua || (BOT_UA.test(ua) && !cfg.analytics.allowHeadlessForTests)) return "bot";
  if (isAdmin) return "admin";
  const b = req.body || {};
  const type = b.t === "pageview" ? "pageview" : b.t === "event" ? "event" : null;
  if (!type) return "invalid";
  const path = cleanPath(b.p);
  if (!path) return "invalid_path";
  let name = "page_view";
  if (type === "event") {
    name = String(b.n || "");
    if (!CLIENT_EVENTS.has(name)) return "invalid_event"; // "purchase" is server-only
  }
  const props = type === "event" ? cleanProps(b.d) : null;
  const now = Date.now();
  const { day, hour } = parts(now, cfg.analytics.timezone);
  const ip = String(req.ip || "");
  const visitor = crypto.createHash("sha256").update(`${saltFor(db, day)}|${ip}|${ua}|${req.get("host") || ""}`).digest("hex").slice(0, 32);
  const country = geoip.lookup(ip);
  db.transaction(() => {
    let s = db.prepare("SELECT * FROM analytics_sessions WHERE visitor=? AND last_seen>=? ORDER BY id DESC LIMIT 1").get(visitor, now - SESSION_GAP_MS);
    if (!s) {
      const id = db.prepare("INSERT INTO analytics_sessions(visitor,day,started_at,last_seen,country,entry_path,referrer,pageviews) VALUES(?,?,?,?,?,?,?,0)")
        .run(visitor, day, now, now, country, path, cleanReferrer(b.r, req.get("host"))).lastInsertRowid;
      s = { id };
    }
    db.prepare("UPDATE analytics_sessions SET last_seen=?, pageviews=pageviews+? WHERE id=?").run(now, type === "pageview" ? 1 : 0, s.id);
    db.prepare("INSERT INTO analytics_events(ts,day,hour,session_id,visitor,type,name,path,country,props,source) VALUES(?,?,?,?,?,?,?,?,?,?, 'client')")
      .run(now, day, hour, s.id, visitor, type, name, path, country, props ? JSON.stringify(props) : null);
  })();
  return "recorded";
}

/** Server-confirmed purchase (called once, when iyzico confirms a non-test payment). */
function recordPurchase(db, cfg, order, units) {
  if (!cfg.analytics.enabled || order.is_test) return false;
  const now = Date.now();
  const { day, hour } = parts(now, cfg.analytics.timezone);
  const props = { value: Math.round(order.paid_cents) / 100, currency: "USD", quantity: units };
  db.prepare("INSERT INTO analytics_events(ts,day,hour,session_id,visitor,type,name,path,country,props,source) VALUES(?,?,?,NULL,NULL,'event','purchase',NULL,?,?, 'server')")
    .run(now, day, hour, geoip.lookup(order.customer_ip), JSON.stringify(props));
  return true;
}

function purge(db, cfg) {
  const cutoff = addDays(dayOf(Date.now(), cfg.analytics.timezone), -cfg.analytics.retentionDays);
  db.prepare("DELETE FROM analytics_events WHERE day < ?").run(cutoff);
  db.prepare("DELETE FROM analytics_sessions WHERE day < ?").run(cutoff);
}

// ---------------------------------------------------------------- reporting
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (c) => { if (!c) return "Unknown"; try { return regionNames.of(c) || c; } catch { return c; } };

function report(db, cfg, query, now = Date.now()) {
  const tz = cfg.analytics.timezone;
  const r = resolveRange(query, tz, now);
  const days = [r.from, r.to];
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  const visitors = one("SELECT COUNT(DISTINCT visitor) n FROM analytics_sessions WHERE day BETWEEN ? AND ?", ...days).n;
  const sessions = one("SELECT COUNT(*) n FROM analytics_sessions WHERE day BETWEEN ? AND ?", ...days).n;
  const pageviews = one("SELECT COUNT(*) n FROM analytics_events WHERE type='pageview' AND day BETWEEN ? AND ?", ...days).n;
  const active = one("SELECT COUNT(DISTINCT visitor) n FROM analytics_sessions WHERE last_seen >= ?", now - ACTIVE_WINDOW_MS).n;

  const countries = all(`SELECT country, COUNT(DISTINCT visitor) visitors, COUNT(*) sessions FROM analytics_sessions
    WHERE day BETWEEN ? AND ? GROUP BY country ORDER BY visitors DESC, sessions DESC`, ...days)
    .map(c => ({ code: c.country || null, name: countryName(c.country), visitors: c.visitors, sessions: c.sessions,
      percent: visitors ? Math.round(c.visitors / visitors * 1000) / 10 : 0 }));

  const pages = all(`SELECT path, COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM analytics_events
    WHERE type='pageview' AND day BETWEEN ? AND ? GROUP BY path ORDER BY views DESC LIMIT 20`, ...days);

  const evRows = all(`SELECT name, COUNT(*) count, COUNT(DISTINCT visitor) visitors FROM analytics_events
    WHERE type='event' AND day BETWEEN ? AND ? GROUP BY name`, ...days);
  const events = FUNNEL.map(name => {
    const e = evRows.find(x => x.name === name);
    return { name, count: e ? e.count : 0, visitors: name === "purchase" ? null : (e ? e.visitors : 0) };
  });

  const referrers = all(`SELECT referrer, COUNT(*) sessions FROM analytics_sessions WHERE day BETWEEN ? AND ? AND referrer IS NOT NULL
    GROUP BY referrer ORDER BY sessions DESC LIMIT 10`, ...days);

  // Time series: hourly for a single day, daily otherwise (zero-filled; zeros are real zeros).
  let series;
  if (r.from === r.to) {
    const rows = all(`SELECT hour, COUNT(DISTINCT visitor) visitors, COUNT(DISTINCT session_id) sessions, SUM(type='pageview') pageviews
      FROM analytics_events WHERE day=? AND source='client' GROUP BY hour`, r.from);
    series = { unit: "hour", points: Array.from({ length: 24 }, (_, h) => {
      const x = rows.find(v => v.hour === h);
      return { key: `${String(h).padStart(2, "0")}:00`, visitors: x ? x.visitors : 0, sessions: x ? x.sessions : 0, pageviews: x ? x.pageviews : 0 };
    }) };
  } else {
    const rows = all(`SELECT s.day, COUNT(DISTINCT s.visitor) visitors, COUNT(*) sessions, SUM(s.pageviews) pageviews
      FROM analytics_sessions s WHERE s.day BETWEEN ? AND ? GROUP BY s.day`, ...days);
    const n = daysBetween(r.from, r.to);
    series = { unit: "day", points: Array.from({ length: n + 1 }, (_, i) => {
      const d = addDays(r.from, i); const x = rows.find(v => v.day === d);
      return { key: d, visitors: x ? x.visitors : 0, sessions: x ? x.sessions : 0, pageviews: x ? x.pageviews : 0 };
    }) };
  }

  // Commerce numbers come from the order database (verified by iyzico), not from tracking.
  const fromIso = new Date(startOfDayUtc(r.from, tz)).toISOString();
  const toIso = new Date(startOfDayUtc(addDays(r.to, 1), tz)).toISOString();
  const started = one("SELECT COUNT(*) n FROM orders WHERE is_test=0 AND created_at >= ? AND created_at < ?", fromIso, toIso).n;
  const paid = one(`SELECT COUNT(*) n, COALESCE(SUM(paid_cents),0) cents FROM orders WHERE is_test=0
    AND payment_status IN ('paid','partially_refunded','refunded') AND paid_at >= ? AND paid_at < ?`, fromIso, toIso);

  return {
    range: { ...r, timezone: tz },
    hasData: sessions > 0 || pageviews > 0 || evRows.length > 0,
    summary: { visitors, sessions, pageviews, active, activeWindowMinutes: ACTIVE_WINDOW_MS / 60_000 },
    countries, pages, events, referrers, series,
    commerce: { ordersStarted: started, paidOrders: paid.n, paidRevenueCents: paid.cents,
      conversionPercent: sessions ? Math.round(paid.n / sessions * 1000) / 10 : null },
    geo: geoip.status(),
    generatedAt: new Date(now).toISOString(),
  };
}

module.exports = { collect, recordPurchase, report, purge, resolveRange, cleanPath, cleanProps, cleanReferrer, startOfDayUtc, CLIENT_EVENTS, RangeError400 };
