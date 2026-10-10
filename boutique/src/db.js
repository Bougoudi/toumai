// SQLite storage. All money is stored in integer cents (USD).
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 5;

const DEFAULT_SETTINGS = {
  product_cost_usd: "27.24",      // supplier price per unit (estimate)
  shipping_cost_usd: "15.00",     // supplier shipping to customer per unit (estimate)
  payment_fee_percent: "0",       // estimated provider fee, % of total (set from your iyzico contract)
  payment_fee_fixed_usd: "0",     // estimated fixed fee per order
};

function open(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.pragma("user_version", { simple: true });
  if (version >= SCHEMA_VERSION) return;
  db.transaction(() => {
    // v1 (starter) stored one product per order in REAL dollars. Keep it for reference.
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
    if (legacy && version < 2) {
      db.exec("ALTER TABLE orders RENAME TO orders_v1_legacy");
      const ev = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='order_events'").get();
      if (ev) db.exec("ALTER TABLE order_events RENAME TO order_events_v1_legacy");
    }
    db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','partially_refunded','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (fulfillment_status IN ('unfulfilled','supplier_order_prepared','supplier_ordered','shipped','delivered','cancelled','return_requested','returned')),
  payment_provider TEXT,
  iyzico_token TEXT UNIQUE,
  iyzico_payment_id TEXT,
  paid_at TEXT,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  fee_estimated_cents INTEGER NOT NULL DEFAULT 0,
  fee_actual_cents INTEGER,
  est_product_cost_cents INTEGER NOT NULL,
  est_shipping_cost_cents INTEGER NOT NULL,
  actual_product_cost_cents INTEGER,
  actual_shipping_cost_cents INTEGER,
  ad_spend_cents INTEGER NOT NULL DEFAULT 0,
  other_cost_cents INTEGER NOT NULL DEFAULT 0,
  supplier_ordered_at TEXT,
  supplier_reference TEXT,
  supplier_confirmation TEXT,
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  shipped_at TEXT,
  shipping_justification TEXT,
  delivered_at TEXT,
  notes TEXT,
  customer_ip TEXT
);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  supplier_sku TEXT,
  product_name TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  supplier_variant TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  event TEXT NOT NULL,
  details TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  request_key TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL,
  provider_ref TEXT,
  reason TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  order_id INTEGER,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  order_number TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  kind TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','sent','failed')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- v3: first-party, cookieless analytics. No IP address, name or email is stored.
-- "visitor" is a SHA-256 of a DAILY random salt + IP + user agent; the salt is deleted
-- the next day, so a visitor can't be recognised across days or linked to a person.
CREATE TABLE IF NOT EXISTS analytics_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  country TEXT,
  entry_path TEXT,
  referrer TEXT,
  pageviews INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS analytics_sessions_day ON analytics_sessions(day);
CREATE INDEX IF NOT EXISTS analytics_sessions_visitor ON analytics_sessions(visitor, last_seen);
CREATE INDEX IF NOT EXISTS analytics_sessions_seen ON analytics_sessions(last_seen);
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  session_id INTEGER,
  visitor TEXT,
  type TEXT NOT NULL CHECK (type IN ('pageview','event')),
  name TEXT NOT NULL,
  path TEXT,
  country TEXT,
  props TEXT,
  source TEXT NOT NULL CHECK (source IN ('client','server'))
);
CREATE INDEX IF NOT EXISTS analytics_events_day ON analytics_events(day, type);
`);
    // v4: marketing — campaigns, content calendar, promotions, UTM attribution.
    db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,              -- utm_campaign
  channel TEXT NOT NULL,
  utm_source TEXT NOT NULL,
  utm_medium TEXT NOT NULL,
  objective TEXT,
  landing_path TEXT NOT NULL DEFAULT '/product',
  budget_cents INTEGER,
  spend_cents INTEGER NOT NULL DEFAULT 0,  -- actual ad spend, entered by the owner
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  angle TEXT NOT NULL,
  title TEXT NOT NULL,
  hook TEXT,
  script TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idea','to_produce','ready','published')),
  publish_date TEXT,
  published_url TEXT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  utm_content TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value INTEGER NOT NULL,                  -- percent (1-50) or cents
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  max_redemptions INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
    const addCol = (table, name, def) => {
      const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    };
    for (const t of ["orders", "analytics_sessions"]) {
      for (const c of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) addCol(t, c, "TEXT");
    }
    addCol("orders", "promo_code", "TEXT");
    addCol("orders", "discount_cents", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS analytics_sessions_campaign ON analytics_sessions(utm_campaign)");
    db.exec("CREATE INDEX IF NOT EXISTS orders_campaign ON orders(utm_campaign)");
    // v5: supplier preparation checklist, anomalies and order holds
    addCol("orders", "on_hold", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`
CREATE TABLE IF NOT EXISTS order_checks (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  actor TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (order_id, item)
);
CREATE TABLE IF NOT EXISTS order_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL,
  details TEXT NOT NULL,
  holds INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS order_issues_order ON order_issues(order_id);
`);

    const ins = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare("SELECT key,value FROM settings").all()) out[r.key] = r.value;
  return out;
}

module.exports = { open, getSettings, DEFAULT_SETTINGS };
