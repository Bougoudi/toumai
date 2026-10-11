// Browser test for the e-mail list invitation: panel timing and placement, dismissal memory,
// cart sign-up showing the real code, and checkout charging the discounted total.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2en-"));
  const cfg = load({ DB_PATH: path.join(dir, "n.sqlite"), PUBLIC_URL: "http://127.0.0.1:4585", STORE_PRICE_USD: "49.99",
    IYZICO_API_KEY: "sandbox-k", IYZICO_SECRET_KEY: "sandbox-s", NEWSLETTER_SIGNUP_LIMIT: "50",
    ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123") });
  const db = open(cfg.dbPath);
  const sessions = {};
  iyzico.setClientForTests({
    checkoutFormInitialize: { create(r, cb) { const t = `tok${Object.keys(sessions).length + 1}`; sessions[t] = r; cb(null, { status: "success", token: t, paymentPageUrl: `https://sandbox-cpp.iyzipay.com/?token=${t}` }); } },
    checkoutForm: { retrieve(r, cb) { cb(null, { status: "failure" }); } }, refundV2: { create(r, cb) { cb(null, { status: "failure" }); } },
  });
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(4585);
  const B = "http://127.0.0.1:4585";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const watch = (p) => { p.on("pageerror", e => errors.push(`${p.url()}: ${e.message}`)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); };
  const clearPrivacy = async (p) => { if (await p.locator("#privacy-choices button").count()) await p.locator("#privacy-choices button").first().click(); };
  const scrollHalf = (p) => p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
  try {
    for (const [label, ctxOpts, email] of [["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "jane@example.com"], ["desktop", { viewport: { width: 1280, height: 900 } }, "sam@example.com"]]) {
      const ctx = await browser.newContext(ctxOpts);
      const p = await ctx.newPage(); watch(p);
      await p.route("https://sandbox-cpp.iyzipay.com/**", r => r.fulfill({ contentType: "text/html", body: "<h1>iyzico (fake)</h1>" }));

      // ---------- invitation on the product page, never over the privacy choices or the buy bar
      await p.goto(B + "/product"); await p.waitForSelector(".swatch"); await clearPrivacy(p);
      assert.equal(await p.locator("#nl-invite").count(), 0, "not shown immediately");
      await scrollHalf(p); await p.waitForSelector("#nl-invite");
      assert.match(await p.textContent("#nl-invite h2"), /^Get 10% off your first order$/);
      assert.equal(await p.locator("#privacy-choices").count(), 0);
      if (label === "phone") {
        await p.waitForSelector("#stickyBuy.visible");
        const inv = await p.locator("#nl-invite").boundingBox(); const bar = await p.locator("#stickyBuy").boundingBox();
        assert.ok(inv.y + inv.height <= bar.y, "invitation sits above the mobile buy bar");
        assert.ok(inv.x >= 0 && inv.x + inv.width <= 390, "fits the screen");
        assert.equal(await p.evaluate(() => window.innerWidth), 390, "no layout widening");
      }
      await p.click("#nl-invite .nl-close");
      assert.equal(await p.locator("#nl-invite").count(), 0);
      await p.reload(); await p.waitForSelector(".swatch"); await scrollHalf(p); await p.waitForTimeout(800);
      assert.equal(await p.locator("#nl-invite").count(), 0, "a dismissed invitation doesn't come back");
      assert.equal(await p.locator("footer .nl-form").count(), 1, "footer sign-up form");

      // ---------- cart: sign up, the real code is shown only after the server confirmed
      await p.click("#addToCart"); await p.goto(B + "/cart"); await p.waitForSelector(".cart-line");
      assert.match(await p.textContent(".nl-slot"), /Get 10% off your first order/);
      await p.fill(".nl-slot input[type=email]", "not-an-email"); await p.click(".nl-slot button[type=submit]");
      assert.match(await p.textContent(".nl-slot .nl-status"), /valid email/);
      await p.fill(".nl-slot input[type=email]", email); await p.click(".nl-slot button[type=submit]");
      await p.waitForSelector(".nl-slot .nl-code strong");
      assert.equal(await p.textContent(".nl-slot .nl-code strong"), "WELCOME10");
      assert.doesNotMatch(await p.textContent(".nl-slot"), /emailed it to you/, "no claim of an email without a provider");
      assert.equal(db.prepare("SELECT source FROM newsletter_subscribers WHERE email=?").get(email).source, "cart");
      await scrollHalf(p); await p.waitForTimeout(500);
      assert.equal(await p.locator("#nl-invite").count(), 0, "no invitation on the cart");

      // ---------- checkout with the code: 10% off, charged by the server
      await p.click("#toCheckout"); await p.waitForURL("**/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" });
      await p.fill("#promoCode", "WELCOME10"); await p.click("#promoForm button");
      await p.waitForFunction(() => document.getElementById("total").textContent === "$44.99");
      assert.match(await p.textContent("#promoTerms"), /One use per subscribed email address/);
      await p.fill("#name", "Jane Doe"); await p.fill("#email", email); await p.fill("#address1", "100 Congress Ave");
      await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
      assert.equal(await p.locator("#nl-invite").count(), 0, "no invitation at checkout");
      await Promise.all([p.waitForURL(/sandbox-cpp\.iyzipay\.com/), p.click("#payButton")]);
      const o = db.prepare("SELECT * FROM orders ORDER BY id DESC").get();
      assert.equal(o.promo_code, "WELCOME10"); assert.equal(o.discount_cents, 500); assert.equal(o.total_cents, 4499);
      assert.equal(sessions[o.iyzico_token].paidPrice, "44.99");
      await ctx.close();
      console.log(`✓ ${label}: invitation timing & placement, dismissal remembered, cart sign-up shows the code, checkout charges $44.99`);
    }

    // ---------- signing up from the invitation panel shows the code inside the panel
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
      const q = await c.newPage(); watch(q);
      await q.goto(B + "/"); await clearPrivacy(q); await scrollHalf(q); await q.waitForSelector("#nl-invite");
      await q.fill("#nl-invite input[type=email]", "pat@example.com"); await q.click("#nl-invite button[type=submit]");
      await q.waitForSelector("#nl-invite .nl-code strong");
      assert.equal(await q.textContent("#nl-invite .nl-code strong"), "WELCOME10");
      assert.equal(db.prepare("SELECT source FROM newsletter_subscribers WHERE email='pat@example.com'").get().source, "popup");
      await q.click("#nl-invite .nl-close"); await q.reload(); await scrollHalf(q); await q.waitForTimeout(800);
      assert.equal(await q.locator("#nl-invite").count(), 0, "not shown again to a subscriber");
      await c.close();
      console.log("✓ invitation panel sign-up shows the code in place, then stays hidden");
    }

    // ---------- a non-subscriber can't use the code (message shown at payment)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage(); watch(p);
    await p.goto(B + "/product"); await p.waitForSelector(".swatch"); await p.click("#addToCart");
    await p.goto(B + "/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" });
    await p.fill("#promoCode", "WELCOME10"); await p.click("#promoForm button"); await p.waitForFunction(() => document.getElementById("total").textContent === "$44.99");
    await p.fill("#name", "Max Doe"); await p.fill("#email", "max@example.com"); await p.fill("#address1", "1 Main St");
    await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
    await p.click("#payButton"); await p.waitForFunction(() => document.getElementById("formError").textContent.length > 0);
    assert.match(await p.textContent("#formError"), /reserved for newsletter subscribers/);
    await ctx.close();
    console.log("✓ non-subscriber: the welcome code is refused at payment with a clear message");

    // ---------- admin: Marketing → Email list
    const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(a);
    await a.goto(B + "/admin"); await a.waitForURL("**/admin-login.html");
    await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]");
    await a.waitForURL("**/admin"); await a.waitForSelector(".tile");
    await a.click('[data-tab="marketing"]'); await a.click('[data-sec="emails"]'); await a.waitForSelector("#mkBody .tile-value");
    assert.deepEqual(await a.$$eval("#mkBody .tile-value", n => n.map(x => x.textContent)), ["3", "0", "0"], "3 subscribed, 0 unsubscribed, 0 paid orders yet (payments still pending)");
    assert.equal(await a.locator('#mkBody a[href="/api/admin/newsletter.csv"]').count(), 1);
    console.log("✓ admin Marketing → Email list: real counts and CSV export");

    assert.deepEqual(errors, [], "no JavaScript errors");
  } finally {
    await browser.close(); server.close(); db.close(); iyzico.setClientForTests(null); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
