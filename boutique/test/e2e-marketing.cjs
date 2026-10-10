// Browser test for marketing: banner on mobile, UTM landing → order attribution, promo code
// at checkout, refusal of analytics, and the admin Marketing tab driven through its forms.
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
const promotions = require("../src/promotions");
const marketing = require("../src/marketing");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2e-mk-"));
  const cfg = load({ DB_PATH: path.join(dir, "db.sqlite"), ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123"),
    ANALYTICS_ALLOW_HEADLESS: "true", GEOIP_AUTO_DOWNLOAD: "false", PUBLIC_URL: "http://127.0.0.1:4571" });
  const db = open(cfg.dbPath);
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(4571);
  const B = "http://127.0.0.1:4571";
  const day = 86400_000;
  promotions.save(db, { code: "COZY10", kind: "percent", value: 10, startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + 20 * day).toISOString() });
  marketing.saveBanner(db, { text: "Launch offer: 10% off your throw", link: "/product", promo: "COZY10", enabled: "1",
    startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + 20 * day).toISOString() });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const page = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, ...opts });
    await ctx.route("https://images.unsplash.com/**", r => r.abort());
    const p = await ctx.newPage(); p.on("pageerror", e => errors.push(e.message)); return p;
  };
  const noOverflow = async (p, label) => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} overflows`);
  const fillCheckout = async (p) => {
    await p.waitForSelector("#state option[value=TX]", { state: "attached" });
    await p.fill("#name", "Jane Doe"); await p.fill("#email", "jane@example.com"); await p.fill("#address1", "100 Congress Ave");
    await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
  };
  try {
    // ---------------- landing from a TikTok link, banner, promo code, order attribution
    let p = await page();
    await p.goto(`${B}/product?utm_source=tiktok&utm_medium=social&utm_campaign=fall-tiktok&utm_content=cold-friend`);
    await p.waitForSelector(".announcement.promo");
    assert.match(await p.textContent(".announcement"), /Launch offer: 10% off your throw/);
    assert.match(await p.textContent(".promo-chip"), /COZY10/);
    await p.click(".promo-terms summary");
    assert.match(await p.textContent(".promo-terms"), /10% off your order subtotal/);
    assert.equal(await p.isVisible(".preview-bar"), true, "demo notice still shown with the banner");
    await noOverflow(p, "product with banner");
    await p.waitForTimeout(300);
    assert.equal(db.prepare("SELECT utm_campaign FROM analytics_sessions").get().utm_campaign, "fall-tiktok");
    await p.click("#plus"); await p.click("#addToCart");
    await p.goto(`${B}/checkout`); await fillCheckout(p);
    await p.waitForFunction(() => document.getElementById("total").textContent === "$149.98");
    await p.fill("#promoCode", "WRONG"); await p.click("#promoForm button");
    await p.waitForFunction(() => document.getElementById("promoError").textContent.length > 0);
    assert.equal(await p.textContent("#total"), "$149.98", "invalid code changes nothing");
    await p.fill("#promoCode", "cozy10"); await p.click("#promoForm button");
    await p.waitForFunction(() => document.getElementById("total").textContent === "$134.98");
    assert.equal(await p.isVisible("#discountRow"), true); assert.match(await p.textContent("#discount"), /−\$15\.00/);
    assert.match(await p.textContent("#promoTerms"), /valid until/);
    await noOverflow(p, "checkout");
    await Promise.all([p.waitForURL("**/order-status**"), p.click("#payButton")]);
    const o = db.prepare("SELECT * FROM orders ORDER BY id DESC").get();
    assert.deepEqual([o.total_cents, o.discount_cents, o.promo_code, o.utm_source, o.utm_campaign, o.utm_content], [13498, 1500, "COZY10", "tiktok", "fall-tiktok", "cold-friend"]);
    console.log("✓ mobile: banner + terms, UTM landing, promo code (invalid then valid), order attributed with the server-computed discount");

    // ---------------- visitor who declined analytics: no campaign stored
    p = await page();
    await p.goto(`${B}/`); await p.click("text=Privacy choices"); await p.click('#privacy-choices [data-choice="denied"]');
    await p.goto(`${B}/product?utm_source=instagram&utm_campaign=gifts-ig`); await p.waitForSelector(".swatch"); await p.click("#addToCart");
    await p.goto(`${B}/checkout`); await fillCheckout(p);
    await Promise.all([p.waitForURL("**/order-status**"), p.click("#payButton")]);
    const o2 = db.prepare("SELECT * FROM orders ORDER BY id DESC").get();
    assert.equal(o2.utm_campaign, null); assert.equal(o2.utm_source, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM analytics_sessions WHERE utm_campaign='gifts-ig'").get().n, 0);
    console.log("✓ declined analytics: no campaign attribution stored");

    // ---------------- admin Marketing tab through the UI
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    const a = await ctx.newPage(); a.on("pageerror", e => errors.push(e.message));
    await a.goto(`${B}/admin`); await a.waitForURL("**/admin-login.html");
    await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]"); await a.waitForURL("**/admin");
    await a.click('[data-tab="marketing"]'); await a.waitForSelector("#campaignForm");
    await a.fill('#campaignForm [name=name]', "Fall TikTok"); await a.fill('#campaignForm [name=slug]', "fall-tiktok");
    await a.fill('#campaignForm [name=spend]', "40"); await a.click("#campaignForm button.admin-btn");
    await a.waitForSelector("#mkBody [data-copy]");
    const row = await a.textContent("#mkBody table");
    assert.match(row, /Fall TikTok/); assert.match(row, /\$40\.00/, "recorded ad spend is shown");
    assert.match(await a.getAttribute("#mkBody [data-copy]", "data-copy"), /utm_campaign=fall-tiktok/);
    assert.match(await a.textContent("#mkBody"), /No confirmed payment yet/);
    if (process.env.SCREENSHOT_DIR) await a.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "admin-marketing.png"), fullPage: true });
    await a.click('[data-sec="content"]'); await a.click("#starters"); await a.waitForFunction(() => document.querySelectorAll("#mkBody tbody tr").length === 3);
    await a.click('[data-sec="promotions"]'); await a.waitForSelector("#promoForm");
    await a.fill('#promoForm [name=code]', "gift15"); await a.fill('#promoForm [name=value]', "15");
    await a.fill('#promoForm [name=startsAt]', "2026-11-01T00:00"); await a.fill('#promoForm [name=endsAt]', "2026-12-24T23:59");
    await a.click("#promoForm button.admin-btn"); await a.waitForFunction(() => /GIFT15/.test(document.getElementById("mkBody").textContent));
    await a.fill('#promoForm [name=code]', "BAD"); await a.fill('#promoForm [name=value]', "90");
    await a.fill('#promoForm [name=startsAt]', "2026-11-01T00:00"); await a.fill('#promoForm [name=endsAt]', "2026-12-24T23:59");
    await a.click("#promoForm button.admin-btn"); await a.waitForFunction(() => /between 1 and 50/.test(document.getElementById("toast").textContent));
    await a.click('[data-sec="banner"]'); await a.waitForSelector("#bannerForm"); assert.match(await a.textContent("#mkBody"), /Live now/);
    await a.click('[data-sec="margin"]'); await a.waitForSelector("#marginOut table");
    assert.match(await a.textContent("#marginOut"), /\$32\.75/, "74.99 − 42.24 = 32.75 before fees/ads");
    console.log("✓ admin Marketing: campaign + UTM link, flags, starter ideas, promo form validation, banner status, margin calculator");
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mp = await m.newPage(); mp.on("pageerror", e => errors.push(e.message));
    await mp.goto(`${B}/admin-login.html`); await mp.fill("#u", "owner"); await mp.fill("#p", "e2e-password-123"); await mp.click("button[type=submit]");
    await mp.waitForURL("**/admin"); await mp.click('[data-tab="marketing"]'); await mp.waitForSelector("#campaignForm");
    await noOverflow(mp, "admin marketing on mobile (page level; wide tables scroll inside their box)");
    assert.deepEqual(errors, [], "no JavaScript errors");
    console.log("✓ no JavaScript errors; mobile layouts fit");
  } finally {
    await browser.close(); server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
