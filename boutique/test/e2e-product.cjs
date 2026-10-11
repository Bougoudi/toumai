// Browser test for the problem-led home page, the product page sections, the FAQ and
// the admin "Product info" tab, on a phone and a desktop.
// Run: npm run test:e2e
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
const productFacts = require("../src/product-facts");

function start(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2ep-"));
  const cfg = load({ DB_PATH: path.join(dir, "s.sqlite"), ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123"),
    PUBLIC_URL: `http://127.0.0.1:${port}`, STORE_PRICE_USD: "49.99", ...env });
  const db = open(cfg.dbPath);
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(port);
  return { B: `http://127.0.0.1:${port}`, db, close() { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

(async () => {
  const sessions = {};
  iyzico.setClientForTests({
    checkoutFormInitialize: { create(r, cb) { const t = `tok${Object.keys(sessions).length + 1}`; sessions[t] = r; cb(null, { status: "success", token: t, paymentPageUrl: `https://sandbox-cpp.iyzipay.com/?token=${t}` }); } },
    checkoutForm: { retrieve(r, cb) { cb(null, { status: "failure" }); } },
    refundV2: { create(r, cb) { cb(null, { status: "failure" }); } },
  });
  const sandbox = start(4571, { IYZICO_API_KEY: "sandbox-k", IYZICO_SECRET_KEY: "sandbox-s" });
  const demo = start(4572, {});
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const watch = (p) => { p.on("pageerror", e => errors.push(`${p.url()}: ${e.message}`)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); };
  const noOverflow = async (p, label) => { const w = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(w <= 0, `${label} overflows horizontally by ${w}px`); };
  const allImagesLoad = async (p, label) => {
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    await p.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 10000 });
    const broken = await p.$$eval("img", n => n.filter(i => i.naturalWidth === 0).map(i => i.getAttribute("src")));
    assert.deepEqual(broken, [], `${label}: broken images`);
  };
  try {
    for (const [label, ctxOpts] of [["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["desktop", { viewport: { width: 1366, height: 900 } }]]) {
      const ctx = await browser.newContext(ctxOpts);
      const p = await ctx.newPage(); watch(p);
      const { B } = sandbox;

      // ---------------- home: problems, trust, consistent price, working links
      await p.goto(B + "/"); await p.waitForLoadState("networkidle");
      await noOverflow(p, `${label} /`); await allImagesLoad(p, `${label} /`);
      assert.equal(await p.locator("#everyday .problem-card").count(), 4, "4 everyday problems");
      for (const h of ["Working in a cool room", "A cozy evening", "Understanding USB power", "A practical winter gift"]) assert.ok(await p.locator(".problem-tag", { hasText: h }).count(), h);
      assert.ok(await p.locator(".photo-placeholder", { hasText: "Photo coming soon" }).count(), "missing photos are clearly labeled placeholders");
      const prices = await p.$$eval("[data-price]", n => n.map(x => x.textContent));
      assert.ok(prices.length && prices.every(x => x === "$49.99"), `home prices: ${prices}`);
      assert.match(await p.textContent("#trustPayment"), /Test mode: card payment on the hosted page of our payment provider, iyzico/);
      const links = [...new Set(await p.$$eval('main a[href^="/"]', n => n.map(a => a.getAttribute("href").split("#")[0])))];
      for (const l of links) assert.equal((await p.request.get(B + l)).status(), 200, `link ${l}`);
      const cta = p.locator(".hero a.button").first(); assert.ok(await cta.isVisible(), "hero buy button visible");
      await Promise.all([p.waitForURL("**/product"), cta.click()]);

      // ---------------- product: sections, placeholders, sticky buy bar
      await p.waitForSelector(".swatch"); await p.waitForSelector("#specTable tr");
      await noOverflow(p, `${label} /product`);
      if (label === "phone") assert.equal(await p.evaluate(() => window.innerWidth), 390, "layout viewport not widened by wide content (e.g. the thumbnail row)");
      // Choosing a color shows that color's photo
      await p.click('.swatch:has-text("Pearl White")');
      assert.match(await p.getAttribute("#mainImage", "src"), /throw-white-reading\.webp$/);
      assert.equal(await p.locator("#thumbs .thumb.active").getAttribute("data-src"), "/images/throw-white-reading.webp");
      assert.equal(await p.$eval("#mainImage", i => i.style.objectPosition), "center 30%", "portrait photo framed on the face");
      assert.equal(await p.locator('#thumbs .thumb[data-src*="throw-white"]').count(), 4);
      assert.equal(await p.locator('#thumbs .thumb[data-src*="bed"]').count(), 0);
      await p.click('.swatch:has-text("Camel Brown")'); await allImagesLoad(p, `${label} /product`);
      assert.equal(await p.textContent("#price"), "$49.99"); assert.equal(await p.textContent("#stickyPrice"), "$49.99");
      assert.equal(await p.textContent("#priceLabel"), "Launch price");
      // Reviews are off by default (REVIEWS_ENABLED unset): no section, no jump link, no footer link
      assert.equal(await p.isVisible("#reviews"), false); assert.equal(await p.isVisible("#reviewsJump"), false);
      assert.equal(await p.locator('footer a[href="/review-policy"]').count(), 0);
      // Owner-confirmed facts are shown; everything else still says it's being confirmed
      const specs = await p.$$eval("#specTable tr", rows => Object.fromEntries(rows.map(r => [r.querySelector("th").textContent, [r.querySelector("td").textContent, r.className]])));
      assert.deepEqual(specs["USB cable length"], ["1.5 m (about 4.9 ft)", ""]);
      assert.deepEqual(specs["Power bank included?"], ["No — sold separately", ""]);
      assert.deepEqual(specs["Automatic shut-off"], ["Yes — automatic shut-off and overheat protection", ""]);
      assert.deepEqual(specs["Dimensions"], ["Being confirmed with our supplier", "tbc"], "dimensions not guessed");
      assert.deepEqual(specs["Heat settings"], ["Being confirmed with our supplier", "tbc"]);
      assert.equal(Object.keys(specs).some(k => /Runtime with the included power bank|Included power bank capacity/.test(k)), false, "no battery rows: no power bank is sold");
      assert.match(await p.textContent("#boxList"), /being confirmed/);
      // Common Questions, Clear Answers: the 6 objections are visible without a click
      assert.deepEqual(await p.$$eval("#clearAnswers .answer-card h3", n => n.map(x => x.textContent)),
        ["Does it get warm enough?", "Does it come with a power bank?", "How long does the battery last?", "How do I clean it?", "What exactly is included?", "When will my order arrive?"]);
      assert.ok(await p.isVisible("#a-warm"), "answers visible");
      assert.match(await p.textContent("#a-warm"), /make no claim about how warm it gets yet/);
      assert.match(await p.textContent("#a-battery"), /No power bank is included, so how long it runs depends on the power bank/);
      assert.match(await p.textContent("#a-power-bank"), /^Does it come with a power bank\?No — a power bank is not included/);
      assert.match(await p.textContent("#a-clean"), /Don't machine-wash it unless its care label says you can/);
      assert.match(await p.textContent("#a-included"), /Please don't assume any accessory is included/);
      assert.match(await p.textContent("#a-included"), /Not included \(optional, sold separately\): USB power bank/);
      assert.match(await p.textContent("#a-arrive"), /we don't promise a delivery date yet/);
      assert.equal(await p.locator("#productFaq details").count(), 6);
      // Before You Order sits in the buy box, before any payment step
      const before = p.locator("#beforeOrder .before-order");
      assert.equal(await before.locator("dt").count(), 6);
      assert.match(await before.textContent(), /Never use it while sleeping/);
      const bBox = await before.boundingBox(); const addBox = await p.locator("#addToCart").boundingBox();
      assert.ok(bBox.y > addBox.y, "Before You Order follows the buy button");
      assert.match(await p.textContent("#payNote"), /Test mode/);
      if (label === "phone") {
        assert.equal(await p.isVisible("#stickyBuy"), true);
        await p.locator("#safety").scrollIntoViewIfNeeded(); await p.waitForSelector("#stickyBuy.visible");
        const box = await p.locator("#stickyAdd").boundingBox();
        assert.ok(box && box.y + box.height <= 844, "sticky buy button inside the viewport");
        await p.click("#stickyAdd"); await p.waitForFunction(() => document.querySelector("[data-cart-count]").textContent === "1");
        assert.equal(await p.textContent("#stickyAdd"), "View cart");
      } else {
        assert.equal(await p.isVisible("#stickyBuy"), false, "no sticky bar on desktop");
        await p.click("#addToCart"); await p.waitForFunction(() => document.querySelector("[data-cart-count]").textContent === "1");
      }

      // ---------------- cart and checkout still work with the same price
      await p.goto(B + "/cart"); await p.waitForSelector(".cart-line");
      assert.equal(await p.textContent("#total"), "$49.99");
      assert.equal(await p.locator("#beforeOrder .before-order").count(), 1, "Before You Order on the cart page");
      await p.click("#toCheckout"); await p.waitForURL("**/checkout"); await p.waitForSelector("#state option[value=TX]", { state: "attached" });
      await p.click("#beforeOrderDetails summary"); assert.match(await p.textContent("#beforeOrderDetails"), /Power source/);
      await p.fill("#name", "Jane Doe"); await p.fill("#email", "jane@example.com"); await p.fill("#address1", "100 Congress Ave");
      await p.fill("#city", "Austin"); await p.selectOption("#state", "TX"); await p.fill("#postalCode", "78701"); await p.check("#agree");
      await p.route("https://sandbox-cpp.iyzipay.com/**", r => r.fulfill({ contentType: "text/html", body: "<h1>iyzico (fake)</h1>" }));
      await Promise.all([p.waitForURL(/sandbox-cpp\.iyzipay\.com/), p.click("#payButton")]);
      const order = sandbox.db.prepare("SELECT total_cents FROM orders ORDER BY id DESC").get();
      assert.equal(order.total_cents, 4999, "server charges the displayed price");

      // ---------------- FAQ answers the objections without inventing
      await p.goto(B + "/faq#q-dimensions"); await p.waitForSelector("#objectionFaq details");
      assert.equal(await p.locator("#objectionFaq details").count(), 12);
      assert.match(await p.textContent("#q-dimensions p"), /being confirmed with our supplier/);
      assert.equal(await p.getAttribute("#q-dimensions", "open"), "", "linked question opens");
      await noOverflow(p, `${label} /faq`);
      await ctx.close();
      console.log(`✓ ${label}: home problems & trust, product sections & buy buttons, price $49.99 everywhere, checkout, FAQ`);
    }

    // ---------------- admin confirms facts → the store shows them
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ctx.newPage(); watch(a);
    await a.goto(sandbox.B + "/admin"); await a.waitForURL("**/admin-login.html");
    await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]");
    await a.waitForURL("**/admin"); await a.waitForSelector(".warn-card");
    assert.match(await a.textContent(".warn-card"), new RegExp(`${productFacts.FIELDS.length - Object.keys(productFacts.CONFIRMED).length} product detail\\(s\\) still to confirm`));
    await a.click('[data-tab="product"]'); await a.waitForSelector("#factsForm");
    await a.fill('#factsForm [name="dimensions"]', "50 × 60 in (127 × 152 cm)");
    await a.selectOption('#factsForm [name="powerBankIncluded"]', "no");
    await a.fill('#factsForm [name="inBox"]', "1 heated throw\n1 user manual");
    await a.click("#factsForm button");
    await a.waitForFunction(n => document.getElementById("factsBadge").textContent === String(n), productFacts.FIELDS.length - Object.keys(productFacts.CONFIRMED).length - 2); // dimensions + box contents added
    const p = await ctx.newPage(); watch(p);
    await p.goto(sandbox.B + "/product"); await p.waitForSelector("#specTable tr");
    assert.match(await p.textContent("#specTable"), /50 × 60 in \(127 × 152 cm\)/);
    assert.match(await p.textContent("#specTable"), /No — sold separately/);
    assert.deepEqual(await p.$$eval("#boxList li", n => n.map(x => x.textContent)), ["1 heated throw", "1 user manual"]);
    assert.match(await p.textContent("#a-power-bank p"), /^No — a power bank is not included/);
    assert.match(await p.textContent("#a-battery"), /No power bank is included, so how long it runs depends on the power bank/);
    assert.deepEqual(await p.$$eval("#a-included li", n => n.map(x => x.textContent)), ["1 heated throw", "1 user manual"]);
    assert.equal((await p.textContent("#beforeOrder")).split("You need a compatible USB power source").length - 1, 1, "power source sentence not repeated");
    assert.match(await p.textContent("#beforeOrder"), /Size: 50 × 60 in \(127 × 152 cm\) · Power input: USB · Cable: 1\.5 m/);
    assert.doesNotMatch(await p.textContent("#specTable"), /Runtime with the included power bank|Included power bank capacity/, "no battery rows when no power bank is sold");
    await ctx.close();
    console.log("✓ admin Product info: saved facts appear on the product page and FAQ");

    // ---------------- demo store: no payment provider claims
    const d = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage(); watch(d);
    await d.goto(demo.B + "/"); await d.waitForLoadState("networkidle");
    assert.equal(await d.locator(".payment-icons").count(), 0, "no payment logos while checkout is disabled");
    assert.match(await d.textContent("#trustPayment"), /opening soon/);
    assert.doesNotMatch(await d.textContent("body"), /iyzico/);
    await d.goto(demo.B + "/product"); await d.waitForSelector("#specTable tr");
    assert.match(await d.textContent("#payNote"), /opening soon/);
    assert.doesNotMatch(await d.textContent("body"), /iyzico|secure checkout/i);
    await d.goto(demo.B + "/faq"); await d.waitForSelector("#objectionFaq details");
    assert.match(await d.textContent("#payAnswer"), /opening soon/);
    console.log("✓ demo mode: no payment logos or provider claims");

    assert.deepEqual(errors, [], "no console errors");
  } finally {
    await browser.close(); sandbox.close(); demo.close(); iyzico.setClientForTests(null);
  }
})().catch(e => { console.error(e); process.exit(1); });
