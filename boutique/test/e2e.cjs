// Browser test (mobile + desktop) with Playwright and a fake iyzico client.
// Run: npm run test:e2e   (needs Playwright; set PLAYWRIGHT_MODULE to its path if not installed locally)
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const iyzico = require("../src/iyzico");
const auth = require("../src/auth");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2e-"));
  const cfg = load({ DB_PATH: path.join(dir, "e2e.sqlite"), ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123"),
    IYZICO_API_KEY: "sandbox-k", IYZICO_SECRET_KEY: "sandbox-s", PUBLIC_URL: "http://127.0.0.1:4555" });
  const db = open(cfg.dbPath);
  const sessions = {};
  iyzico.setClientForTests({
    checkoutFormInitialize: { create(r, cb) { const t = `tok${Object.keys(sessions).length + 1}`; sessions[t] = r; cb(null, { status: "success", token: t, paymentPageUrl: `https://sandbox-cpp.iyzipay.com/?token=${t}` }); } },
    checkoutForm: { retrieve(r, cb) { const s = sessions[r.token]; cb(null, { status: "success", paymentStatus: "SUCCESS", fraudStatus: 1, token: r.token, basketId: s.basketId, currency: s.currency, paidPrice: s.paidPrice, paymentId: "PAY1" }); } },
    refundV2: { create(r, cb) { cb(null, { status: "success", paymentId: r.paymentId }); } },
  });
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(4555);
  const B = "http://127.0.0.1:4555";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const watch = (p) => { p.on("pageerror", e => errors.push(`${p.url()}: ${e.message}`)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); };
  const noOverflow = async (p, label) => { const w = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(w <= 0, `${label} overflows horizontally by ${w}px`); };
  try {
    // ---------------- customer on a phone
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await phone.newPage(); watch(p);
    await p.route("https://sandbox-cpp.iyzipay.com/**", r => r.fulfill({ contentType: "text/html", body: "<h1>iyzico (fake)</h1>" }));
    await p.route("https://images.unsplash.com/**", r => r.abort());
    for (const page of ["/", "/product", "/cart", "/faq", "/contact", "/shipping", "/returns", "/privacy", "/terms"]) {
      await p.goto(B + page); await p.waitForLoadState("networkidle"); await noOverflow(p, page);
    }
    await p.goto(B + "/");
    await p.click(".menu-toggle");
    assert.equal(await p.getAttribute(".menu-toggle", "aria-expanded"), "true");
    await p.click('.site-nav a[href="/product"]'); await p.waitForURL("**/product");
    await p.waitForSelector(".swatch");
    assert.equal(await p.isDisabled(".swatch >> nth=1"), true, "unconfirmed colour cannot be bought");
    await p.click("#plus"); await p.click("#addToCart");
    assert.equal(await p.textContent("[data-cart-count]"), "2");
    await p.goto(B + "/cart"); await p.waitForSelector(".cart-line");
    assert.equal(await p.textContent("#total"), "$149.98");
    await p.click("#toCheckout"); await p.waitForURL("**/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" });
    await p.fill("#name", "Jane Doe"); await p.fill("#email", "jane@example.com"); await p.fill("#address1", "100 Congress Ave");
    await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
    await noOverflow(p, "/checkout");
    await Promise.all([p.waitForURL(/sandbox-cpp\.iyzipay\.com/), p.click("#payButton")]);
    const order = db.prepare("SELECT * FROM orders ORDER BY id DESC").get();
    assert.equal(order.total_cents, 14998); assert.equal(order.payment_status, "pending");
    // iyzico posts the customer back to the callback
    await p.goto("about:blank");
    await p.setContent(`<form method="post" action="${B}/api/checkout/iyzico/callback"><input name="token" value="${order.iyzico_token}"></form>`);
    await Promise.all([p.waitForURL("**/order-status**"), p.evaluate(() => document.forms[0].submit())]);
    await p.waitForFunction(() => document.getElementById("title").textContent !== "Checking your order…");
    assert.equal(await p.textContent("#title"), "Your payment is confirmed.");
    console.log("✓ mobile storefront: menu, product, cart, checkout, iyzico redirect, confirmation");

    // ---------------- owner in the admin (desktop + phone)
    for (const [label, ctxOpts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true }]]) {
      const ctx = await browser.newContext({ ...ctxOpts, permissions: ["clipboard-read", "clipboard-write"] });
      const a = await ctx.newPage(); watch(a);
      await a.goto(B + "/admin"); await a.waitForURL("**/admin-login.html");
      await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]");
      await a.waitForURL("**/admin"); await a.waitForSelector(".tile");
      if (label === "phone") { await noOverflow(a, "admin dashboard"); await ctx.close(); continue; }
      assert.match(await a.textContent("#dashboard"), /Paid orders/);
      if (process.env.SCREENSHOT_DIR) await a.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "admin-dashboard.png") });
      await a.click('[data-tab="orders"]'); await a.waitForSelector("tr[data-id]"); await a.click("tr[data-id]");
      await a.waitForSelector("#copySupplier"); await a.click("#copySupplier"); await a.waitForSelector("#supplierText:not([hidden])");
      const text = await a.textContent("#supplierText");
      assert.match(text, /Quantity: 2/); assert.ok(!text.includes("jane@example.com"));
      await a.fill('#supplierForm [name=supplierReference]', "AE-777"); await a.fill('#supplierForm [name=actualProductCost]', "54.00");
      await a.click("#supplierForm button"); await a.waitForSelector("#shipForm button:not([disabled])");
      await a.fill('#shipForm [name=carrier]', "USPS"); await a.fill('#shipForm [name=trackingNumber]', "9400111899");
      await a.fill('#shipForm [name=trackingUrl]', "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899");
      await a.click("#shipForm button"); await a.waitForSelector(".email-draft");
      assert.match(await a.textContent(".email-draft"), /prepared — NOT sent/);
      if (process.env.SCREENSHOT_DIR) await a.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "admin-order.png"), fullPage: false });
      await a.fill('#refundForm [name=amount]', "10.00");
      a.once("dialog", d => d.accept());
      await a.click("#refundForm button"); await a.waitForFunction(() => document.querySelector("#detail").textContent.includes("partially refunded"));
      const row = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
      assert.equal(row.fulfillment_status, "shipped"); assert.equal(row.refunded_cents, 1000); assert.equal(row.actual_product_cost_cents, 5400);
      console.log("✓ admin: login, dashboard, Copy Supplier Order, supplier order, shipment + email draft, refund");
      await ctx.close();
    }
    assert.deepEqual(errors, [], "no JavaScript errors");
    console.log("✓ no JavaScript errors, no horizontal overflow on mobile");
  } finally {
    await browser.close(); server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
