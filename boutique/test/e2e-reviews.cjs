// Browser tests for customer reviews: form initial state, validation & accessibility,
// single submission, failure handling, safe rendering, mobile layout and the admin queue.
// Isolated temporary database; no real review is submitted anywhere else.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const auth = require("../src/auth");

const COMMENT = "Soft and warm at my desk. The cable could be longer, but it does the job for me.";

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2er-"));
  const cfg = load({ DB_PATH: path.join(dir, "r.sqlite"), ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword("e2e-password-123"),
    PUBLIC_URL: "http://127.0.0.1:4581", REVIEW_SUBMIT_LIMIT: "100" });
  const db = open(cfg.dbPath);
  const server = createApp({ cfg, db, log: { log() {}, warn() {}, error() {} } }).listen(4581);
  const B = "http://127.0.0.1:4581";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const watch = (p) => { p.on("pageerror", e => errors.push(`${p.url()}: ${e.message}`)); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); };
  const noOverflow = async (p, label) => { const w = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(w <= 0, `${label} overflows by ${w}px`); };
  const reviewCount = () => db.prepare("SELECT COUNT(*) n FROM reviews").get().n;
  try {
    for (const [label, ctxOpts] of [["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
      const ctx = await browser.newContext(ctxOpts);
      const p = await ctx.newPage(); watch(p);
      const posts = [];
      p.on("request", r => { if (r.method() === "POST" && r.url().includes("/api/reviews")) posts.push(r.url()); });

      // ---------- empty state, no write on load
      const before = reviewCount();
      await p.goto(B + "/product#reviews"); await p.waitForSelector(".no-reviews");
      assert.equal(await p.textContent(".no-reviews"), "No reviews yet. Be the first to share your experience.");
      assert.equal(await p.isVisible("#reviewPager"), false, "no pagination without reviews");
      await p.waitForLoadState("networkidle");
      assert.equal(posts.length, 0, "no review request on page load"); assert.equal(reviewCount(), before, "no insertion on page load");
      await noOverflow(p, `${label} product with reviews section`);

      // ---------- initial demo state (exact)
      const state = await p.evaluate(() => {
        const f = document.getElementById("reviewForm"); const fd = new FormData(f);
        return { rating: Number(fd.get("rating")), displayName: fd.get("displayName"), title: fd.get("title"), comment: fd.get("comment"),
          purchasedFromHavenLume: fd.get("purchasedFromHavenLume"), wouldRecommend: fd.get("wouldRecommend"), publicationConsent: document.getElementById("publicationConsent").checked };
      });
      assert.deepEqual(state, { rating: 5, displayName: "", title: "", comment: "", purchasedFromHavenLume: "yes", wouldRecommend: "yes", publicationConsent: false });
      assert.equal(await p.isDisabled("#submitReview"), true, "disabled in the demo state");
      assert.equal(await p.getAttribute("#publicationConsent", "checked"), null, "consent not pre-checked");
      assert.match(await p.textContent("#verifyBox"), /isn't available yet/, "no email provider: the badge flow says so");

      // ---------- validation: each missing condition keeps the button disabled
      const comment = `${COMMENT} (${label})`;
      await p.fill("#displayName", "Dana R."); await p.fill("#reviewComment", comment);
      assert.equal(await p.isDisabled("#submitReview"), true, "consent missing");
      await p.check("#publicationConsent");
      assert.equal(await p.isDisabled("#submitReview"), false, "valid input enables the button");
      await p.fill("#displayName", "A"); await p.locator("#displayName").blur();
      assert.equal(await p.isDisabled("#submitReview"), true, "name too short");
      assert.equal(await p.getAttribute("#displayName", "aria-invalid"), "true");
      assert.match(await p.getAttribute("#displayName", "aria-describedby"), /err-displayName/);
      assert.equal(await p.$eval("#displayName", e => getComputedStyle(e).borderTopColor), "rgb(164, 61, 47)", "invalid field is visibly marked");
      assert.match(await p.textContent("#err-displayName"), /2 to 40 characters/);
      await p.fill("#displayName", "Dana R."); assert.equal(await p.getAttribute("#displayName", "aria-invalid"), null);
      await p.fill("#reviewComment", "a".repeat(19)); await p.locator("#reviewComment").blur();
      assert.equal(await p.isDisabled("#submitReview"), true, "comment too short");
      assert.match(await p.textContent("#commentCount"), /^19 \/ 1,500 characters \(minimum 20\)/);
      assert.match(await p.textContent("#err-comment"), /at least 20/);
      await p.fill("#reviewComment", "       " + "a".repeat(19) + "        ");
      assert.equal(await p.isDisabled("#submitReview"), true, "surrounding spaces don't count");
      await p.fill("#reviewComment", "x".repeat(1501));
      assert.equal(await p.isDisabled("#submitReview"), true, "comment too long"); assert.match(await p.textContent("#err-comment"), /1500 characters or fewer/);
      await p.fill("#reviewComment", comment);
      // keyboard: change the rating with the arrow keys
      await p.focus("#rate5"); await p.keyboard.press("ArrowRight");
      assert.equal(await p.evaluate(() => new FormData(document.getElementById("reviewForm")).get("rating")), "4");
      assert.equal(await p.textContent("#ratingText"), "4 out of 5");
      await p.uncheck("#publicationConsent"); assert.equal(await p.isDisabled("#submitReview"), true);
      await p.check("#publicationConsent"); assert.equal(await p.isDisabled("#submitReview"), false);

      // ---------- server failure: no fake success, form usable again
      await p.route("**/api/reviews", r => r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Unexpected error (ref test)." }) }) : r.continue());
      await p.click("#submitReview");
      await p.waitForFunction(() => document.getElementById("reviewError").textContent.length > 0);
      assert.match(await p.textContent("#reviewError"), /Unexpected error/);
      assert.equal(await p.locator(".review-thanks").count(), 0, "no confirmation after a failure");
      assert.equal(await p.isDisabled("#submitReview"), false); assert.equal(await p.isDisabled("#displayName"), false);
      await p.unroute("**/api/reviews");
      assert.equal(reviewCount(), before);

      // ---------- double click: exactly one request, loading state, confirmation after 201
      posts.length = 0;
      let release;
      const gate = new Promise(r => { release = r; });
      await p.route("**/api/reviews", async r => { if (r.request().method() === "POST") { await gate; return r.continue(); } return r.continue(); });
      await p.locator("#submitReview").dblclick();
      await p.waitForFunction(() => document.getElementById("reviewStatus").textContent === "Sending your review…");
      assert.equal(await p.isDisabled("#submitReview"), true); assert.equal(await p.isDisabled("#reviewComment"), true);
      assert.equal(await p.getAttribute("#reviewForm", "aria-busy"), "true");
      await p.click("#submitReview", { force: true }).catch(() => {});
      release();
      await p.waitForSelector(".review-thanks");
      assert.equal(posts.length, 1, "one request despite double click");
      assert.match(await p.textContent(".review-thanks"), /after a quick check by our team/);
      await p.unroute("**/api/reviews");
      assert.equal(reviewCount(), before + 1);
      assert.equal(db.prepare("SELECT moderation_status s FROM reviews ORDER BY id DESC").get().s, "pending");
      // still nothing public before moderation
      await p.goto(B + "/product#reviews"); await p.waitForSelector(".no-reviews");
      await ctx.close();
      console.log(`✓ ${label}: empty state, exact initial state, disabled until valid, accessible errors, failure handling, single submission, pending until moderated`);
    }

    // ---------- admin: Reviews queue (approve, reject with reason, history)
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await actx.newPage(); watch(a);
    // an XSS attempt and a verified review created directly in the isolated test database
    const xss = "<img src=x onerror=\"window.__xss=1\"> <script>window.__xss=2</script> Nice throw, I really like the texture.";
    await a.request.post(B + "/api/reviews", { data: { productId: "usb-heated-throw", rating: 2, displayName: "<b>Max</b>", comment: xss, purchasedFromHavenLume: "no", wouldRecommend: "no", publicationConsent: true } });
    await a.goto(B + "/admin"); await a.waitForURL("**/admin-login.html");
    await a.fill("#u", "owner"); await a.fill("#p", "e2e-password-123"); await a.click("button[type=submit]");
    await a.waitForURL("**/admin"); await a.waitForSelector(".tile");
    assert.match(await a.textContent("#dashboard"), /3 review\(s\) waiting for moderation/);
    await a.click('[data-tab="reviews"]'); await a.waitForSelector(".review-mod");
    assert.equal(await a.locator(".review-mod").count(), 3);
    assert.equal(await a.evaluate(() => window.__xss), undefined, "admin renders review text safely");
    // reject one with a reason (no reason → error)
    const first = a.locator(".review-mod", { hasText: "(phone)" });
    await first.locator('button[value="reject"]').click();
    await a.waitForFunction(() => document.getElementById("toast").textContent.includes("Choose a moderation reason"));
    await first.locator('select[name="reason"]').selectOption("off_topic");
    await first.locator('button[value="reject"]').click();
    await a.waitForFunction(() => document.querySelectorAll(".review-mod").length === 2);
    // approve the two others (one is the XSS attempt)
    for (let i = 0; i < 2; i++) { await a.locator('.review-mod button[value="approve"]').first().click(); await a.waitForFunction(n => document.querySelectorAll(".review-mod").length === n, 1 - i); }
    await a.click('[data-rfilter="approved"]'); await a.waitForSelector(".review-mod");
    await a.locator("[data-history]").first().click(); await a.waitForSelector(".mod-history:not([hidden]) li");
    assert.match(await a.textContent(".mod-history"), /owner: approve \(pending → approved\)/);
    await actx.close();
    console.log("✓ admin Reviews: queue, reason required to reject, approve, filter, moderation history");

    // ---------- public display after moderation (mobile)
    const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage(); watch(m);
    await m.goto(B + "/product#reviews"); await m.waitForSelector(".review-card");
    assert.equal(await m.locator(".review-card").count(), 2);
    assert.equal(await m.textContent(".reviews-summary .avg strong"), "3.0", "(4 + 2) / 2");
    assert.match(await m.textContent(".reviews-summary"), /Based on 2 published reviews/);
    assert.deepEqual(await m.$$eval(".distribution .dist-count", n => n.map(x => x.textContent)), ["0", "1", "0", "1", "0"]);
    assert.equal(await m.evaluate(() => window.__xss), undefined, "injected script never ran");
    assert.equal(await m.locator(".review-card script, .review-card img").count(), 0, "no HTML element created from review text");
    assert.ok((await m.$$eval(".review-text", n => n.map(x => x.textContent))).includes(xss), "shown as plain text");
    assert.ok((await m.$$eval(".review-meta", n => n.map(x => x.textContent))).some(t => t.startsWith("<b>Max</b> · ")));
    assert.equal(await m.locator(".verified").count(), 0, "no badge without a verified order");
    // Fixture in the isolated test DB: a verified, approved review → exactly one badge
    const oid = db.prepare("INSERT INTO orders(order_number,created_at,updated_at,customer_name,customer_email,address1,city,state,postal_code,subtotal_cents,total_cents,est_product_cost_cents,est_shipping_cost_cents,payment_status,fulfillment_status) VALUES('HL-E2EFIX','t','t','A B','a@b.co','1','c','TX','78701',1,1,1,1,'paid','delivered')").run().lastInsertRowid;
    db.prepare("INSERT INTO reviews(public_id,product_id,rating,display_name,comment,purchased_from_havenlume,publication_consent,moderation_status,purchase_verification_status,purchase_order_id,fingerprint,created_at,updated_at,published_at) VALUES('fixv','usb-heated-throw',5,'Lee','Verified fixture review text for the badge test.','yes',1,'approved','verified',?,'fx','t','t','2026-10-10T00:00:00.000Z')").run(oid);
    await m.reload(); await m.waitForSelector(".review-card .verified");
    assert.equal(await m.locator(".review-card .verified").count(), 1, "badge only on the verified review");
    assert.equal(await m.textContent(".review-card .verified"), "Verified Purchase");
    assert.doesNotMatch(await m.textContent("#reviews"), /HL-E2EFIX|a@b\.co/, "order number and email never shown");
    await noOverflow(m, "phone product with reviews");
    console.log("✓ public reviews: real average and distribution, safe text rendering, no badge without verification, mobile layout");

    assert.deepEqual(errors, [], "no JavaScript errors");
  } finally {
    await browser.close(); server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
