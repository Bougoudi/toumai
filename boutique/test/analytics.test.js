// Analytics: access control, collection, privacy, countries, periods, errors, purchases.
// Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const geoip = require("../src/geoip");
const analytics = require("../src/analytics");
const { load } = require("../src/config");
const { startStore, placeOrder, paidOrder } = require("./helpers");

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIXTURE = [
  "0.0.0.0,7.255.255.255,ZZ", "8.0.0.0,8.255.255.255,US", "9.0.0.0,80.255.255.255,ZZ", "81.0.0.0,81.255.255.255,GB",
  "82.0.0.0,255.255.255.255,ZZ", "::,2001:db7:ffff:ffff:ffff:ffff:ffff:ffff,ZZ", "2001:db8::,2001:db8:ffff:ffff:ffff:ffff:ffff:ffff,FR",
  "2001:db9::,ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff,ZZ",
].join("\n");

const hit = (s, ip, body, headers = {}) => s.req("POST", "/api/collect", body, { "User-Agent": UA, "X-Forwarded-For": ip, ...headers });
const pv = (p, r) => ({ t: "pageview", p, r });
const ev = (n, d, p = "/product") => ({ t: "event", n, p, d });

async function store(env = {}) {
  geoip.loadCsv(FIXTURE, "fixture");
  return startStore({ TRUST_PROXY: "true", ANALYTICS_TIMEZONE: "America/New_York", ...env });
}

test("A. the analytics dashboard is admin-only", async () => {
  const s = await store();
  try {
    assert.equal((await s.req("GET", "/api/admin/analytics")).status, 401);
    assert.equal((await s.req("GET", "/api/admin/analytics", undefined, { Cookie: "hl_admin=" + "b".repeat(64) })).status, 401);
    const h = await s.login();
    const r = await s.req("GET", "/api/admin/analytics?range=7d", undefined, h);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
  } finally { s.close(); }
});

test("B. no data: zeros and empty lists, never invented numbers", async () => {
  const s = await store();
  try {
    const h = await s.login();
    const r = (await s.req("GET", "/api/admin/analytics?range=7d", undefined, h)).json;
    assert.equal(r.hasData, false);
    assert.deepEqual(r.summary, { visitors: 0, sessions: 0, pageviews: 0, active: 0, activeWindowMinutes: 5 });
    assert.deepEqual(r.countries, []); assert.deepEqual(r.pages, []); assert.deepEqual(r.referrers, []);
    assert.ok(r.events.every(e => e.count === 0));
    assert.equal(r.series.points.length, 7);
    assert.ok(r.series.points.every(p => p.visitors === 0 && p.sessions === 0 && p.pageviews === 0));
    assert.deepEqual(r.commerce, { ordersStarted: 0, paidOrders: 0, paidRevenueCents: 0, conversionPercent: null });
  } finally { s.close(); }
});

test("C. visits are counted per visitor/session, with countries and percentages", async () => {
  const s = await store();
  try {
    for (const ip of ["8.8.8.8", "8.8.4.4", "8.1.2.3"]) assert.equal((await hit(s, ip, pv("/", "https://www.google.com/search?q=throw"))).status, 204);
    await hit(s, "8.8.8.8", pv("/product.html?utm_source=x"));
    await hit(s, "8.8.8.8", ev("view_item", { item_id: "usb-heated-throw", value: 74.99, currency: "USD" }));
    await hit(s, "8.8.8.8", ev("add_to_cart", { item_id: "usb-heated-throw", variant: "camel-brown", quantity: 2, value: 149.98, currency: "USD" }));
    await hit(s, "81.2.69.142", pv("/product"));
    await hit(s, "2001:db8::1", pv("/faq"));
    await hit(s, "10.0.0.1", pv("/cart"));
    const h = await s.login();
    const r = (await s.req("GET", "/api/admin/analytics?range=today", undefined, h)).json;
    assert.equal(r.hasData, true);
    assert.equal(r.summary.visitors, 6);
    assert.equal(r.summary.sessions, 6);
    assert.equal(r.summary.pageviews, 7);
    assert.equal(r.summary.active, 6);
    const byCode = Object.fromEntries(r.countries.map(c => [c.code, c]));
    assert.equal(byCode.US.visitors, 3); assert.equal(byCode.US.percent, 50); assert.equal(byCode.US.name, "United States");
    assert.equal(byCode.GB.visitors, 1); assert.equal(byCode.GB.name, "United Kingdom");
    assert.equal(byCode.FR.visitors, 1);
    assert.equal(r.countries.find(c => c.code === null).name, "Unknown");
    assert.equal(Math.round(r.countries.reduce((n, c) => n + c.percent, 0)), 100);
    const pages = Object.fromEntries(r.pages.map(p => [p.path, p.views]));
    assert.equal(pages["/"], 3); assert.equal(pages["/product"], 2, "query string and .html removed");
    const evs = Object.fromEntries(r.events.map(e => [e.name, e.count]));
    assert.equal(evs.view_item, 1); assert.equal(evs.add_to_cart, 1); assert.equal(evs.purchase, 0);
    assert.deepEqual(r.referrers, [{ referrer: "google.com", sessions: 3 }]);
    assert.equal(r.series.unit, "hour"); assert.equal(r.series.points.length, 24);
    assert.equal(r.series.points.reduce((n, p) => n + p.pageviews, 0), 7);
  } finally { s.close(); }
});

test("D. periods: today, 7 days, 30 days, custom; invalid ranges are refused", async () => {
  const s = await store();
  try {
    const h = await s.login();
    const tz = "America/New_York";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    // Real rows on chosen days (inserted directly to place them in the past)
    const add = (day, visitor) => {
      const id = s.db.prepare("INSERT INTO analytics_sessions(visitor,day,started_at,last_seen,country,entry_path,pageviews) VALUES(?,?,0,0,'US','/',1)").run(visitor, day).lastInsertRowid;
      s.db.prepare("INSERT INTO analytics_events(ts,day,hour,session_id,visitor,type,name,path,country,source) VALUES(0,?,9,?,?,'pageview','page_view','/','US','client')").run(day, id, visitor);
    };
    add(today, "v-today"); add(shift(today, -3), "v-3"); add(shift(today, -20), "v-20"); add(shift(today, -60), "v-60");
    const get = async (q) => (await s.req("GET", `/api/admin/analytics?${q}`, undefined, h));
    assert.equal((await get("range=today")).json.summary.visitors, 1);
    assert.equal((await get("range=7d")).json.summary.visitors, 2);
    assert.equal((await get("range=30d")).json.summary.visitors, 3);
    assert.equal((await get("range=30d")).json.series.points.length, 30);
    const custom = (await get(`range=custom&from=${shift(today, -61)}&to=${shift(today, -19)}`)).json;
    assert.equal(custom.summary.visitors, 2); assert.equal(custom.series.points.length, 43);
    assert.equal(custom.range.from, shift(today, -61));
    for (const q of [`range=custom&from=2026-02-30&to=${today}`, `range=custom&from=${today}&to=${shift(today, -1)}`,
      `range=custom&from=${today}&to=${shift(today, 1)}`, `range=custom&from=${shift(today, -400)}&to=${today}`, "range=custom", "range=year"]) {
      const r = await get(q);
      assert.equal(r.status, 400, q); assert.ok(r.json.error);
    }
  } finally { s.close(); }
});

test("E. privacy: GPC/DNT, bots, the admin and personal data are never recorded", async () => {
  const s = await store();
  try {
    const count = () => s.db.prepare("SELECT COUNT(*) n FROM analytics_events").get().n;
    await hit(s, "8.8.8.8", pv("/"), { "Sec-GPC": "1" });
    await hit(s, "8.8.8.8", pv("/"), { DNT: "1" });
    await hit(s, "8.8.8.8", pv("/"), { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await hit(s, "8.8.8.8", pv("/"), { "User-Agent": "" });
    const h = await s.login();
    await hit(s, "8.8.8.8", pv("/"), { Cookie: h.Cookie });
    assert.equal(count(), 0, "nothing recorded for opted-out visitors, bots or the admin");

    // Personal data in paths, referrers, names or properties is rejected or stripped
    await hit(s, "8.9.9.9", pv("/order-status?order=HL-ABC&k=secret&email=jane@example.com"));
    await hit(s, "8.9.9.9", pv("/jane@example.com"));
    await hit(s, "8.9.9.9", pv("/admin"));
    await hit(s, "8.9.9.9", pv("https://evil.example/x"));
    await hit(s, "8.9.9.9", ev("add_to_cart", { item_id: "usb-heated-throw", quantity: 1, email: "jane@example.com", name: "Jane Doe", address: "100 Congress Ave", variant: "Jane Doe" }));
    await hit(s, "8.9.9.9", ev("purchase", { value: 999, currency: "USD" }));
    await hit(s, "8.9.9.9", ev("identify", { item_id: "x" }));
    const rows = s.db.prepare("SELECT * FROM analytics_events").all();
    assert.deepEqual(rows.map(r => r.path).sort(), ["/order-status", "/product"]);
    const props = JSON.parse(rows.find(r => r.name === "add_to_cart").props);
    assert.deepEqual(props, { item_id: "usb-heated-throw", quantity: 1 });
    assert.equal(rows.some(r => r.name === "purchase"), false, "the browser can't report a purchase");

    // No raw IP, email, name or order number anywhere in the analytics tables
    const dump = JSON.stringify([...s.db.prepare("SELECT * FROM analytics_events").all(), ...s.db.prepare("SELECT * FROM analytics_sessions").all()]);
    for (const secret of ["8.9.9.9", "jane", "Jane", "HL-ABC", "Congress", "secret"]) assert.equal(dump.includes(secret), false, secret);
    // Only today's salt is kept
    s.db.prepare("INSERT INTO analytics_salts(day,salt) VALUES('2000-01-01','old')").run();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    s.db.prepare("DELETE FROM analytics_salts WHERE day=?").run(today);
    await hit(s, "8.6.6.6", pv("/"));
    assert.deepEqual(s.db.prepare("SELECT day FROM analytics_salts").all().map(r => r.day), [today]);

    // Analytics can be switched off entirely
    const off = await store({ ANALYTICS_ENABLED: "false" });
    try {
      await hit(off, "8.8.8.8", pv("/"));
      assert.equal(off.db.prepare("SELECT COUNT(*) n FROM analytics_events").get().n, 0);
      assert.equal((await off.req("GET", "/api/config")).json.analytics.enabled, false);
    } finally { off.close(); }
  } finally { s.close(); }
});

test("F. purchase is recorded once, server-side, only for real verified payments", async () => {
  const s = await store();
  try {
    const paid = await paidOrder(s, [{ variantId: "camel-brown", quantity: 2 }]);
    // replayed callback: still one purchase
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${paid.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    s.fake.mode = "declined";
    const { o: declined } = await placeOrder(s);
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${declined.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    const purchases = s.db.prepare("SELECT * FROM analytics_events WHERE name='purchase'").all();
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].source, "server");
    assert.deepEqual(JSON.parse(purchases[0].props), { value: 149.98, currency: "USD", quantity: 2 });
    const h = await s.login();
    const r = (await s.req("GET", "/api/admin/analytics?range=today", undefined, h)).json;
    assert.equal(r.events.find(e => e.name === "purchase").count, 1);
    assert.equal(r.commerce.paidOrders, 1); assert.equal(r.commerce.paidRevenueCents, 14998);
    assert.equal(r.commerce.ordersStarted, 2, "declined order started but not paid");
  } finally { s.close(); }

  // Demo orders never produce a purchase
  const d = await store({ IYZICO_API_KEY: "" });
  try {
    const r = await d.req("POST", "/api/checkout", { customer: { name: "Jane Doe", email: "j@example.com", address1: "1 Main", city: "Austin", state: "TX", postalCode: "78701" }, items: [{ variantId: "camel-brown", quantity: 1 }] });
    assert.equal(r.json.mode, "demo");
    assert.equal(d.db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE name='purchase'").get().n, 0);
    const h = await d.login();
    assert.equal((await d.req("GET", "/api/admin/analytics?range=today", undefined, h)).json.commerce.ordersStarted, 0);
  } finally { d.close(); }
});

test("G. geolocation provider errors leave countries Unknown and are reported", async () => {
  geoip.resetForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-geo-"));
  const silent = { log() {}, warn() {}, error() {} };
  try {
    const cfg = load({ DB_PATH: path.join(dir, "x.sqlite") });
    const failing = async () => { throw new Error("network down"); };
    const st = await geoip.init(cfg, silent, failing);
    assert.equal(st.loaded, false); assert.match(st.error, /could not download/);
    assert.equal(geoip.lookup("8.8.8.8"), null);
    const s = await startStore({ TRUST_PROXY: "true" });
    try {
      await hit(s, "8.8.8.8", pv("/"));
      const h = await s.login();
      const r = (await s.req("GET", "/api/admin/analytics?range=today", undefined, h)).json;
      assert.equal(r.geo.loaded, false); assert.ok(r.geo.error);
      assert.deepEqual(r.countries.map(c => c.name), ["Unknown"]);
      assert.equal(r.summary.visitors, 1, "visits are still counted");
    } finally { s.close(); }
    // A 404 for this month falls back to last month's file
    const gz = zlib.gzipSync(FIXTURE);
    const calls = [];
    const fake = async (url) => { calls.push(url); return calls.length === 1 ? { ok: false } : { ok: true, arrayBuffer: async () => gz }; };
    const ok = await geoip.init(cfg, silent, fake);
    assert.equal(ok.loaded, true); assert.equal(calls.length, 2);
    assert.match(calls[0], /^https:\/\/download\.db-ip\.com\/free\/dbip-country-lite-\d{4}-\d{2}\.csv\.gz$/);
    assert.equal(geoip.lookup("::ffff:81.2.3.4"), "GB"); assert.equal(geoip.lookup("2001:db8::5"), "FR");
    // A corrupt download is rejected
    geoip.resetForTests(); fs.rmSync(cfg.geoip.path);
    const corrupt = await geoip.init(cfg, silent, async () => ({ ok: true, arrayBuffer: async () => Buffer.from("not gzip") }));
    assert.equal(corrupt.loaded, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); geoip.loadCsv(FIXTURE, "fixture"); }
});

test("H. active visitors use a 5-minute window; old data is purged", async () => {
  const s = await store();
  try {
    await hit(s, "8.8.8.8", pv("/"));
    s.db.prepare("INSERT INTO analytics_sessions(visitor,day,started_at,last_seen,pageviews) VALUES('old','2026-01-01',?,?,1)").run(Date.now() - 600_000, Date.now() - 600_000);
    const h = await s.login();
    assert.equal((await s.req("GET", "/api/admin/analytics?range=today", undefined, h)).json.summary.active, 1);
    s.db.prepare("INSERT INTO analytics_events(ts,day,hour,type,name,source) VALUES(0,'2001-01-01',0,'pageview','page_view','client')").run();
    analytics.purge(s.db, s.cfg);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE day='2001-01-01'").get().n, 0);
  } finally { s.close(); }
});

test("I. sanitisers", () => {
  assert.equal(analytics.cleanPath("/product.html?x=1#y"), "/product");
  assert.equal(analytics.cleanPath("/index.html"), "/");
  assert.equal(analytics.cleanPath("//evil.example"), null);
  assert.equal(analytics.cleanPath("/a b"), null);
  assert.equal(analytics.cleanPath("/api/collect"), null);
  assert.equal(analytics.cleanReferrer("https://www.google.com/search?q=jane", "havenlume.onrender.com"), "google.com");
  assert.equal(analytics.cleanReferrer("https://havenlume.onrender.com/cart", "havenlume.onrender.com"), null);
  assert.equal(analytics.cleanReferrer("javascript:alert(1)", "x"), null);
  assert.deepEqual(analytics.cleanProps({ value: 10.555, currency: "EUR", quantity: 1.5, item_id: "Bad Id" }), { value: 10.56 });
});
