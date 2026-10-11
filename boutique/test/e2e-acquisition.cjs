// Browser test: color links, AI-illustration label, optional marketing tags (consent / GPC),
// and the marketing "purchase" event only after a server-verified payment.
// Provider scripts are intercepted: nothing is sent to Meta or Google.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const iyzico = require("../src/iyzico");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2ea-"));
  const cfg = load({ DB_PATH: path.join(dir, "a.sqlite"), PUBLIC_URL: "http://127.0.0.1:4587", STORE_PRICE_USD: "49.99",
    IYZICO_API_KEY: "sandbox-k", IYZICO_SECRET_KEY: "sandbox-s", META_PIXEL_ID: "123456789012345", GA4_MEASUREMENT_ID: "G-TEST1234" });
  const db = open(cfg.dbPath);
  const sessions = {}; let pay = "success";
  iyzico.setClientForTests({
    checkoutFormInitialize: { create(r, cb) { const t = `tok${Object.keys(sessions).length + 1}`; sessions[t] = r; cb(null, { status: "success", token: t, paymentPageUrl: `https://sandbox-cpp.iyzipay.com/?token=${t}` }); } },
    checkoutForm: { retrieve(r, cb) { const s = sessions[r.token];
      cb(null, pay === "success" ? { status: "success", paymentStatus: "SUCCESS", fraudStatus: 1, token: r.token, basketId: s.basketId, currency: s.currency, paidPrice: s.paidPrice, paymentId: "PAY1" }
        : { status: "success", paymentStatus: "FAILURE", token: r.token, basketId: s.basketId, errorMessage: "declined" }); } },
    refundV2: { create(r, cb) { cb(null, { status: "failure" }); } },
  });
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(4587);
  const B = "http://127.0.0.1:4587";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const providerHits = [];
  async function page(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    if (opts.gpc) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    await ctx.route(/connect\.facebook\.net|googletagmanager\.com|analytics\.tiktok\.com|s\.pinimg\.com/, r => { providerHits.push(r.request().url()); r.fulfill({ contentType: "application/javascript", body: "/* stub */" }); });
    await ctx.route("https://sandbox-cpp.iyzipay.com/**", r => r.fulfill({ contentType: "text/html", body: "<h1>iyzico (fake)</h1>" }));
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(`${p.url()}: ${e.message}`));
    p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); });
    return { ctx, p };
  }
  const fbqEvents = (p) => p.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map(a => Array.from(a)) : null));
  const tracked = (q, name) => (q || []).filter(a => a[0] === "track" && a[1] === name);
  try {
    // ---------- color link + AI label + tags allowed (default opt-out mode, no GPC)
    {
      const { ctx, p } = await page();
      await p.goto(B + "/product?color=pearl-white"); await p.waitForSelector(".swatch");
      assert.equal(await p.textContent("#variantName"), "Pearl White", "?color preselects the color");
      assert.match(await p.getAttribute("#mainImage", "src"), /throw-white-reading\.webp$/);
      assert.equal(await p.isVisible("#aiLabel"), true); assert.equal(await p.textContent("#aiLabel"), "Illustration — AI-generated image");
      await p.click('#thumbs .thumb[data-src="/images/throw-white-wrap.webp"]');
      assert.equal(await p.isVisible("#aiLabel"), false, "real supplier photo: no AI label");
      await p.click('.swatch:has-text("Camel Brown")');
      assert.equal(await p.isVisible("#aiLabel"), false);
      await p.waitForFunction(() => window.HLTags && window.fbq);
      const q = await fbqEvents(p);
      assert.deepEqual(q.find(a => a[0] === "dataProcessingOptions"), ["dataProcessingOptions", ["LDU"], 0, 0]);
      assert.equal(tracked(q, "PageView").length, 1); assert.equal(tracked(q, "ViewContent").length, 1);
      assert.equal(JSON.stringify(q).includes("@"), false, "no e-mail sent to the pixel");
      assert.ok(providerHits.some(u => u.includes("connect.facebook.net")) && providerHits.some(u => u.includes("googletagmanager.com")));
      await ctx.close();
      console.log("✓ ?color link, AI-illustration label, tags loaded only when allowed (Meta LDU, no personal data)");
    }

    // ---------- Global Privacy Control: no tags at all
    {
      providerHits.length = 0;
      const { ctx, p } = await page({ gpc: true });
      await p.goto(B + "/product"); await p.waitForSelector(".swatch"); await p.waitForTimeout(800);
      assert.equal(await p.evaluate(() => typeof window.fbq), "undefined");
      assert.equal(await p.locator('script[src="/js/tags.js"]').count(), 0);
      assert.deepEqual(providerHits, [], "no provider request with GPC");
      await ctx.close();
      console.log("✓ Global Privacy Control: no marketing tag loaded");
    }

    // ---------- purchase: only for a server-verified payment, once per order
    const checkout = async (p) => {
      await p.goto(B + "/product"); await p.waitForSelector(".swatch"); await p.click("#addToCart");
      await p.goto(B + "/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" });
      await p.fill("#name", "Jane Doe"); await p.fill("#email", "jane@example.com"); await p.fill("#address1", "100 Congress Ave");
      await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
      await Promise.all([p.waitForURL(/sandbox-cpp\.iyzipay\.com/), p.click("#payButton")]);
      const order = db.prepare("SELECT * FROM orders ORDER BY id DESC").get();
      await p.goto("about:blank");
      await p.setContent(`<form method="post" action="${B}/api/checkout/iyzico/callback"><input name="token" value="${order.iyzico_token}"></form>`);
      await Promise.all([p.waitForURL("**/order-status**"), p.evaluate(() => document.forms[0].submit())]);
      await p.waitForFunction(() => document.getElementById("title").textContent !== "Checking your order…");
      return order;
    };
    {
      const { ctx, p } = await page();
      pay = "failure";
      await checkout(p);
      assert.equal(await p.textContent("#title"), "Your payment did not go through.");
      await p.waitForFunction(() => window.HLTags); await p.waitForTimeout(300);
      assert.equal(tracked(await fbqEvents(p), "Purchase").length, 0, "no purchase for a failed payment");
      assert.equal(tracked(await fbqEvents(p), "InitiateCheckout").length, 0, "checkout events belong to the checkout page");

      pay = "success";
      const order = await checkout(p);
      assert.equal(await p.textContent("#title"), "Your payment is confirmed.");
      await p.waitForFunction(() => window.HLTags); await p.waitForTimeout(300);
      const purchases = tracked(await fbqEvents(p), "Purchase");
      assert.equal(purchases.length, 1);
      assert.equal(order.total_cents, 9998, "the cart kept the item after the failed payment, so 2 throws");
      assert.deepEqual(purchases[0][2], { currency: "USD", value: order.total_cents / 100, content_type: "product", content_ids: ["usb-heated-throw"] }, "value = server-confirmed order total");
      assert.deepEqual(purchases[0][3], { eventID: order.order_number }, "deduplication id = order number");
      await p.reload(); await p.waitForFunction(() => window.HLTags); await p.waitForTimeout(300);
      assert.equal(tracked(await fbqEvents(p), "Purchase").length, 0, "reloading the confirmation never counts a second purchase");
      await ctx.close();
      console.log("✓ purchase sent once, only after the server verified the payment");
    }
    assert.deepEqual(errors, [], "no JavaScript errors");
  } finally {
    await browser.close(); server.close(); db.close(); iyzico.setClientForTests(null); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
