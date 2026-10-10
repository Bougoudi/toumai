// Browser test for analytics: consent modes, refusal, GPC, payload privacy, admin tab states.
// Run: npm run test:e2e   (needs Playwright; set PLAYWRIGHT_MODULE to its path if not installed locally)
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const auth = require("../src/auth");
const geoip = require("../src/geoip");

function boot(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2e-an-"));
  const cfg = load({ DB_PATH: path.join(dir, "db.sqlite"), ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123"),
    ANALYTICS_ALLOW_HEADLESS: "true", ...env });
  const db = open(cfg.dbPath);
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(port);
  return { B: `http://127.0.0.1:${port}`, db, close() { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const count = (s, where = "1=1") => s.db.prepare(`SELECT COUNT(*) n FROM analytics_events WHERE ${where}`).get().n;
const settle = (p) => p.waitForTimeout(400);

(async () => {
  geoip.loadCsv("0.0.0.0,126.255.255.255,ZZ\n127.0.0.0,127.255.255.255,US\n128.0.0.0,255.255.255.255,ZZ", "e2e");
  const optOut = boot(4561, {});
  const optIn = boot(4562, { ANALYTICS_CONSENT_MODE: "opt-in" });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const watch = (p) => p.on("pageerror", e => errors.push(e.message));
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, ...opts });
    await ctx.route("https://images.unsplash.com/**", r => r.abort());
    const p = await ctx.newPage(); watch(p); return p;
  };
  try {
    // ---------------- opt-out mode (default): measured, until the visitor declines
    let p = await newPage();
    const bodies = [];
    p.on("request", r => { if (r.url().endsWith("/api/collect")) bodies.push(r.postData() || ""); });
    await p.goto(optOut.B + "/"); await settle(p);
    assert.equal(count(optOut, "name='page_view'"), 1, "page_view recorded");
    assert.equal(await p.isVisible("#privacy-choices"), false, "no banner in opt-out mode");
    await p.goto(optOut.B + "/product"); await p.waitForSelector(".swatch"); await p.click("#addToCart"); await settle(p);
    assert.equal(count(optOut, "name='view_item'"), 1); assert.equal(count(optOut, "name='add_to_cart'"), 1);
    await p.goto(optOut.B + "/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" }); await settle(p);
    assert.equal(count(optOut, "name='begin_checkout'"), 1);
    await p.fill("#name", "Jane Doe"); await p.fill("#email", "jane@example.com"); await p.fill("#address1", "100 Congress Ave");
    await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
    await Promise.all([p.waitForURL("**/order-status**"), p.click("#payButton")]); await settle(p);
    assert.equal(count(optOut, "name='add_payment_info'"), 1);
    assert.equal(count(optOut, "name='purchase'"), 0, "demo order: no purchase");
    const all = bodies.join("\n");
    for (const pii of ["Jane", "jane@example.com", "Congress", "78701", "HL-TEST"]) assert.equal(all.includes(pii), false, `payload leaks ${pii}`);
    assert.equal(count(optOut, "path LIKE '%?%'"), 0, "no query strings stored");
    // Decline via the footer link
    await p.click("text=Privacy choices"); await p.click('#privacy-choices [data-choice="denied"]');
    const before = count(optOut);
    await p.goto(optOut.B + "/faq"); await p.goto(optOut.B + "/product"); await p.waitForSelector(".swatch"); await settle(p);
    assert.equal(count(optOut), before, "nothing recorded after declining");
    console.log("✓ opt-out mode: events recorded, no personal data sent, refusal respected");

    // ---------------- Global Privacy Control
    p = await newPage();
    await p.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    const gpcBefore = count(optOut);
    await p.goto(optOut.B + "/"); await p.goto(optOut.B + "/product"); await p.waitForSelector(".swatch"); await settle(p);
    assert.equal(count(optOut), gpcBefore, "GPC: nothing recorded");
    console.log("✓ Global Privacy Control respected");

    // ---------------- opt-in mode: nothing before consent
    p = await newPage();
    await p.goto(optIn.B + "/product"); await p.waitForSelector("#privacy-choices"); await settle(p);
    assert.equal(count(optIn), 0, "nothing before consent");
    await p.click('#privacy-choices [data-choice="denied"]');
    await p.goto(optIn.B + "/faq"); await settle(p);
    assert.equal(count(optIn), 0, "nothing after refusal");
    assert.equal(await p.isVisible("#privacy-choices"), false, "banner not shown again after a choice");
    p = await newPage();
    await p.goto(optIn.B + "/"); await p.waitForSelector("#privacy-choices");
    await p.click('#privacy-choices [data-choice="granted"]'); await settle(p);
    assert.equal(count(optIn, "name='page_view'"), 1, "page view sent right after consent");
    await p.goto(optIn.B + "/product"); await p.waitForSelector(".swatch"); await settle(p);
    assert.equal(count(optIn, "name='view_item'"), 1);
    console.log("✓ opt-in mode: banner, nothing before consent, refusal and consent respected");

    // ---------------- admin analytics tab
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ctx.newPage(); watch(a);
    await a.goto(optOut.B + "/admin"); await a.waitForURL("**/admin-login.html");
    await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]");
    await a.waitForURL("**/admin"); await a.click('[data-tab="analytics"]');
    await a.waitForSelector("#analytics .tile");
    const tiles = await a.$$eval("#analytics .tile-value", n => n.map(x => x.textContent));
    const realVisitors = optOut.db.prepare("SELECT COUNT(DISTINCT visitor) n FROM analytics_sessions").get().n;
    assert.equal(tiles[0], String(realVisitors), "tile shows the real visitor count");
    assert.match(await a.textContent("#analytics"), /United States/);
    assert.match(await a.textContent("#analytics"), /IP Geolocation by DB-IP/);
    assert.ok(await a.$$eval("#anChart path.bar", n => n.length) >= 1, "chart has bars");
    assert.match(await a.textContent("#anUpdated"), /Last updated/);
    if (process.env.SCREENSHOT_DIR) await a.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "admin-analytics.png"), fullPage: true });
    await a.focus("#anChart rect.hit >> nth=6"); assert.equal(await a.isVisible(".chart-tip"), true, "tooltip on keyboard focus");
    await a.click("#anTableToggle"); assert.equal(await a.isVisible("#anTable"), true);
    // Custom range with no data -> empty state, zeros
    await a.click('[data-range="custom"]'); await a.fill("#anFrom", "2025-01-01"); await a.fill("#anTo", "2025-01-31"); await a.click("#anApply");
    await a.waitForFunction(() => /No visits recorded/.test(document.getElementById("analytics").textContent));
    const emptyTiles = await a.$$eval("#analytics .tile-value", n => n.map(x => x.textContent));
    assert.deepEqual(emptyTiles.slice(0, 3), ["0", "0", "0"], "period with no data shows zeros");
    // "Active now" is real time (last 5 minutes), independent of the selected period
    const activeNow = optOut.db.prepare("SELECT COUNT(DISTINCT visitor) n FROM analytics_sessions WHERE last_seen >= ?").get(Date.now() - 300_000).n;
    assert.equal(emptyTiles[3], String(activeNow));
    // Server error -> error state with retry
    await a.route("**/api/admin/analytics**", r => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Unexpected error (ref test)" }) }));
    await a.click("#anRefresh"); await a.waitForSelector(".an-state.error");
    assert.match(await a.textContent(".an-state.error"), /Could not load analytics/);
    await a.unroute("**/api/admin/analytics**"); await a.click("#anRetry"); await a.waitForSelector("#analytics .tile");
    // Network failure
    await a.route("**/api/admin/analytics**", r => r.abort());
    await a.click("#anRefresh"); await a.waitForSelector(".an-state.error");
    console.log("✓ admin analytics: real counts, countries, chart + tooltip + table, empty and error states");
    // The admin's own visits are not counted
    const adminBefore = count(optOut);
    await a.unroute("**/api/admin/analytics**"); await a.goto(optOut.B + "/product"); await a.waitForSelector(".swatch"); await settle(a);
    assert.equal(count(optOut), adminBefore, "admin's browsing is not counted");
    console.log("✓ admin browsing excluded");

    assert.deepEqual(errors, [], "no JavaScript errors");
    console.log("✓ no JavaScript errors");
  } finally {
    await browser.close(); optOut.close(); optIn.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
