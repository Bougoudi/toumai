// Marketing: permissions, campaigns + UTM, content calendar, promo codes (server-side),
// banner, attribution report, margins, SEO / Merchant feed.
// Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("../src/config");
const { unitEconomics } = require("../src/profit");
const geoip = require("../src/geoip");
const { CUSTOMER, startStore, placeOrder } = require("./helpers");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const DAY = 86400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const ITEMS1 = [{ variantId: "camel-brown", quantity: 1 }];
const ITEMS2 = [{ variantId: "camel-brown", quantity: 2 }];

async function admin(s) {
  const h = await s.login();
  return { h, post: (p, b) => s.req("POST", p, b, h), get: (p) => s.req("GET", p, undefined, h) };
}
const promo = (code, extra = {}) => ({ code, kind: "percent", value: 10, minSubtotal: "0", startsAt: iso(-DAY), endsAt: iso(30 * DAY), ...extra });

test("M1. every marketing route requires the admin (and CSRF for writes)", async () => {
  const s = await startStore();
  try {
    for (const [m, p] of [["GET", "/api/admin/marketing"], ["POST", "/api/admin/marketing/campaigns"], ["POST", "/api/admin/marketing/campaigns/1"],
      ["POST", "/api/admin/marketing/content"], ["POST", "/api/admin/marketing/content/1/delete"], ["POST", "/api/admin/marketing/content-starters"],
      ["POST", "/api/admin/marketing/promotions"], ["POST", "/api/admin/marketing/banner"], ["POST", "/api/admin/marketing/unit-economics"]]) {
      assert.equal((await s.req(m, p, m === "POST" ? {} : undefined)).status, 401, `${m} ${p}`);
    }
    const h = await s.login();
    assert.equal((await s.req("POST", "/api/admin/marketing/campaigns", { name: "x", channel: "tiktok" }, { Cookie: h.Cookie })).status, 403, "CSRF token required");
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM campaigns").get().n, 0);
  } finally { s.close(); }
});

test("M2. campaigns: validation and UTM tracking links", async () => {
  const s = await startStore({ PUBLIC_URL: "https://shop.example.com" });
  try {
    const a = await admin(s);
    for (const [body, msg] of [
      [{ channel: "tiktok" }, /name is required/], [{ name: "X", channel: "myspace" }, /channel/],
      [{ name: "X", channel: "tiktok", landingPath: "https://evil.example" }, /Landing page/], [{ name: "X", channel: "tiktok", landingPath: "//evil.example" }, /Landing page/],
      [{ name: "X", channel: "tiktok", startDate: "2026-11-10", endDate: "2026-11-01" }, /End date/], [{ name: "X", channel: "tiktok", budget: "-5" }, /Budget/],
      [{ name: "X", channel: "tiktok", slug: "Bad Tag!" }, /utm_campaign/],
    ]) {
      const r = await a.post("/api/admin/marketing/campaigns", body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, msg);
    }
    const r = await a.post("/api/admin/marketing/campaigns", { name: "Fall Launch – TikTok", channel: "tiktok", budget: "250", objective: "First 20 paid orders" });
    assert.equal(r.status, 201);
    const c = s.db.prepare("SELECT * FROM campaigns WHERE id=?").get(r.json.id);
    assert.equal(c.slug, "fall-launch-tiktok"); assert.equal(c.utm_source, "tiktok"); assert.equal(c.utm_medium, "social"); assert.equal(c.budget_cents, 25000);
    assert.equal((await a.post("/api/admin/marketing/campaigns", { name: "Fall launch tiktok", channel: "instagram" })).status, 400, "duplicate tag refused");
    const m = (await a.get("/api/admin/marketing")).json;
    assert.equal(m.report.campaigns[0].url, "https://shop.example.com/product?utm_source=tiktok&utm_medium=social&utm_campaign=fall-launch-tiktok");
    // No data yet: zeros/nulls and explicit flags, never invented results
    const k = m.report.campaigns[0];
    assert.deepEqual(k.tracked, { sessions: 0, visitors: 0, product_views: 0, add_to_cart: 0, begin_checkout: 0 });
    assert.equal(k.paid_orders, 0); assert.equal(k.cac_cents, null); assert.equal(k.roas, null); assert.equal(k.profit_after_spend_cents, null);
    assert.ok(k.flags.some(f => /No ad spend recorded/.test(f))); assert.ok(k.flags.some(f => /profitability not demonstrated/.test(f)));
    assert.equal((await a.post(`/api/admin/marketing/campaigns/${r.json.id}`, { spend: "120.50", archived: "1" })).status, 200);
    const u = s.db.prepare("SELECT * FROM campaigns WHERE id=?").get(r.json.id);
    assert.equal(u.spend_cents, 12050); assert.equal(u.archived, 1); assert.equal(u.name, "Fall Launch – TikTok", "partial update keeps other fields");
    assert.equal((await a.post("/api/admin/marketing/campaigns/999", { name: "x", channel: "tiktok" })).status, 404);
  } finally { s.close(); }
});

test("M3. content calendar: angles, statuses, tracking links, starters, delete", async () => {
  const s = await startStore({ PUBLIC_URL: "https://shop.example.com" });
  try {
    const a = await admin(s);
    const camp = (await a.post("/api/admin/marketing/campaigns", { name: "Gifts IG", channel: "instagram" })).json.id;
    assert.equal((await a.post("/api/admin/marketing/content", { title: "X", angle: "bad", channel: "tiktok" })).status, 400);
    assert.equal((await a.post("/api/admin/marketing/content", { title: "X", angle: "cold_season_gifts", channel: "tiktok", status: "published" })).status, 400, "published needs a URL");
    assert.equal((await a.post("/api/admin/marketing/content", { title: "X", angle: "cold_season_gifts", channel: "tiktok", status: "ready", publishedUrl: "http://insecure" })).status, 400);
    assert.equal((await a.post("/api/admin/marketing/content", { title: "X", angle: "cold_season_gifts", channel: "tiktok", campaignId: "999" })).status, 400);
    const r = await a.post("/api/admin/marketing/content", { title: "Always cold friend", angle: "cold_season_gifts", channel: "instagram", hook: "This one's for them", script: "1. Unwrap", status: "to_produce", publishDate: "2026-11-20", campaignId: String(camp) });
    assert.equal(r.status, 201);
    const list = (await a.get("/api/admin/marketing")).json.content;
    assert.equal(list[0].utm_content, "always-cold-friend");
    assert.equal(list[0].tracking_url, "https://shop.example.com/product?utm_source=instagram&utm_medium=social&utm_campaign=gifts-ig&utm_content=always-cold-friend");
    assert.equal((await a.post(`/api/admin/marketing/content/${r.json.id}`, { status: "published", publishedUrl: "https://www.instagram.com/p/abc" })).status, 200);
    assert.equal((await a.post("/api/admin/marketing/content-starters")).json.created, 3);
    assert.equal((await a.post("/api/admin/marketing/content-starters")).json.created, 0, "starters are not duplicated");
    const angles = s.db.prepare("SELECT DISTINCT angle FROM content_items").all().map(x => x.angle).sort();
    assert.deepEqual(angles, ["cold_season_gifts", "relaxing_at_home", "work_from_home"]);
    assert.equal((await a.post(`/api/admin/marketing/content/${r.json.id}/delete`)).status, 200);
    assert.equal((await a.post(`/api/admin/marketing/content/${r.json.id}/delete`)).status, 404);
  } finally { s.close(); }
});

test("M4. promo codes: rules are enforced on the server and the discount is really charged", async () => {
  const s = await startStore();
  try {
    const a = await admin(s);
    for (const [body, msg] of [
      [promo("COZY", { value: 60 }), /between 1 and 50/], [promo("X1"), /Code/], [promo("FLAT", { kind: "fixed", value: "10", minSubtotal: "5" }), /minimum subtotal/],
      [promo("LATE", { endsAt: iso(-2 * DAY) }), /end date/],
    ]) {
      const r = await a.post("/api/admin/marketing/promotions", body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, msg);
    }
    assert.equal((await a.post("/api/admin/marketing/promotions", promo("cozy10"))).status, 201);
    assert.equal((await a.post("/api/admin/marketing/promotions", promo("COZY10"))).status, 400, "duplicate");
    await a.post("/api/admin/marketing/promotions", promo("FLAT10", { kind: "fixed", value: "10", minSubtotal: "100" }));
    await a.post("/api/admin/marketing/promotions", promo("SOON", { startsAt: iso(DAY), endsAt: iso(5 * DAY) }));
    await a.post("/api/admin/marketing/promotions", promo("ENDED", { startsAt: iso(-10 * DAY), endsAt: iso(-DAY) }));
    await a.post("/api/admin/marketing/promotions", promo("OFF", { active: "0" }));
    await a.post("/api/admin/marketing/promotions", promo("ONCE", { maxRedemptions: "1" }));

    const quote = (code, items = ITEMS2) => s.req("POST", "/api/quote", { items, promoCode: code });
    const q = (await quote("cozy10")).json;
    assert.deepEqual([q.subtotal_cents, q.discount_cents, q.total_cents], [14998, 1500, 13498]);
    assert.match(q.promo.conditions, /10% off your order subtotal/);
    assert.equal((await quote("FLAT10", ITEMS1)).status, 400, "minimum subtotal enforced");
    assert.equal((await quote("FLAT10", ITEMS2)).json.discount_cents, 1000);
    for (const code of ["SOON", "ENDED", "OFF", "NOPE", "<script>"]) assert.equal((await quote(code)).status, 400, code);
    // Client-supplied discount/total fields are ignored
    assert.equal((await s.req("POST", "/api/quote", { items: ITEMS2, discount_cents: 9999, total: 1 })).json.total_cents, 14998);

    // Checkout with an invalid code is refused (never silently charged at full price)
    assert.equal((await s.req("POST", "/api/checkout", { customer: CUSTOMER, items: ITEMS2, promoCode: "ENDED" })).status, 400);
    // Valid code: order total, iyzico basket and amount charged all include the discount
    const { o } = await placeOrder(s, ITEMS2, { promoCode: "cozy10" });
    assert.deepEqual([o.subtotal_cents, o.discount_cents, o.total_cents, o.promo_code], [14998, 1500, 13498, "COZY10"]);
    const sent = s.fake.sessions[o.iyzico_token];
    assert.equal(sent.price, "134.98"); assert.equal(sent.paidPrice, "134.98");
    assert.equal(sent.basketItems.reduce((n, b) => n + Math.round(Number(b.price) * 100), 0), 13498, "basket adds up to the charged amount");
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    const paid = s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id);
    assert.equal(paid.payment_status, "paid"); assert.equal(paid.paid_cents, 13498);
    // Usage limit counts confirmed payments only
    const { o: first } = await placeOrder(s, ITEMS1, { promoCode: "ONCE" });
    assert.ok(first.discount_cents > 0);
    assert.equal((await quote("ONCE")).status, 200, "an unpaid order doesn't consume the code");
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${first.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    const after = await quote("ONCE");
    assert.equal(after.status, 400); assert.match(after.json.error, /usage limit/);
    // Admin list shows real redemptions and discounts
    const list = (await a.get("/api/admin/marketing")).json.promotions;
    const cozy = list.find(p => p.code === "COZY10");
    assert.equal(cozy.paid_redemptions, 1); assert.equal(cozy.discount_given_cents, 1500); assert.equal(cozy.live, true);
    // Re-editing without "active" keeps a disabled code disabled
    const offId = list.find(p => p.code === "OFF").id;
    await a.post(`/api/admin/marketing/promotions/${offId}`, { description: "still off" });
    assert.equal(s.db.prepare("SELECT active FROM promotions WHERE id=?").get(offId).active, 0);
    // Dashboard: revenue is the discounted amount actually paid; discounts are reported, not subtracted twice
    const d = (await a.get("/api/admin/dashboard")).json.totals;
    assert.equal(d.gross_paid_cents, 13498 + first.total_cents); assert.equal(d.discounts_cents, 1500 + first.discount_cents);
    assert.equal(d.revenue_cents, d.gross_paid_cents);
  } finally { s.close(); }
});

test("M5. banner: real dates, safe text, hidden when its code isn't valid", async () => {
  const s = await startStore();
  try {
    const a = await admin(s);
    await a.post("/api/admin/marketing/promotions", promo("COZY10", { endsAt: iso(2 * DAY) }));
    for (const [body, msg] of [
      [{ text: "Hi", enabled: "1" }, /start and end/], [{ text: "<b>x</b>", enabled: "1", startsAt: iso(-DAY), endsAt: iso(DAY) }, /can't contain/],
      [{ text: "Hi", link: "https://evil.example", enabled: "1", startsAt: iso(-DAY), endsAt: iso(DAY) }, /Landing page|path/],
      [{ text: "Hi", promo: "NOPE", enabled: "1", startsAt: iso(-DAY), endsAt: iso(DAY) }, /Unknown promo/], [{ text: "", enabled: "1" }, /required/],
    ]) {
      const r = await a.post("/api/admin/marketing/banner", body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, msg);
    }
    const cfgBanner = async () => (await s.req("GET", "/api/config")).json.banner;
    assert.equal(await cfgBanner(), null);
    await a.post("/api/admin/marketing/banner", { text: "Launch offer", link: "/product", promo: "cozy10", enabled: "1", startsAt: iso(-DAY), endsAt: iso(10 * DAY) });
    const b = await cfgBanner();
    assert.equal(b.text, "Launch offer"); assert.equal(b.promo.code, "COZY10"); assert.match(b.promo.conditions, /10% off/);
    // The code expires before the banner: the banner disappears with it
    s.db.prepare("UPDATE promotions SET ends_at=? WHERE code='COZY10'").run(iso(-1000));
    assert.equal(await cfgBanner(), null);
    await a.post("/api/admin/marketing/banner", { text: "Future", enabled: "1", startsAt: iso(DAY), endsAt: iso(2 * DAY) });
    assert.equal(await cfgBanner(), null, "not shown before its start date");
    await a.post("/api/admin/marketing/banner", { text: "Off", enabled: "0" });
    assert.equal(await cfgBanner(), null);
  } finally { s.close(); }
});

test("M6. campaign attribution: UTM on sessions and orders, CAC and ROAS from real data only", async () => {
  geoip.loadCsv("0.0.0.0,255.255.255.255,US", "test");
  const s = await startStore({ TRUST_PROXY: "true" });
  try {
    const a = await admin(s);
    const id = (await a.post("/api/admin/marketing/campaigns", { name: "Fall TikTok", channel: "tiktok", slug: "fall-tiktok" })).json.id;
    const hit = (ip, body) => s.req("POST", "/api/collect", body, { "User-Agent": UA, "X-Forwarded-For": ip });
    await hit("8.1.1.1", { t: "pageview", p: "/product", u: { source: "tiktok", medium: "social", campaign: "fall-tiktok", content: "cold-friend" } });
    await hit("8.1.1.1", { t: "event", n: "view_item", p: "/product", d: { item_id: "usb-heated-throw" } });
    await hit("8.1.1.1", { t: "event", n: "add_to_cart", p: "/product", d: { quantity: 1 } });
    await hit("8.1.1.2", { t: "pageview", p: "/", u: { source: "tiktok", campaign: "fall-tiktok" } });
    await hit("8.1.1.3", { t: "pageview", p: "/", u: { source: "Bad Value!", campaign: "x@y.com" } }); // dropped
    await hit("8.1.1.4", { t: "pageview", p: "/" });
    const sess = s.db.prepare("SELECT utm_source, utm_campaign, utm_content FROM analytics_sessions ORDER BY id").all();
    assert.deepEqual(sess[0], { utm_source: "tiktok", utm_campaign: "fall-tiktok", utm_content: "cold-friend" });
    assert.deepEqual(sess[2], { utm_source: null, utm_campaign: null, utm_content: null }, "malformed tags are not stored");

    const utm = { source: "tiktok", medium: "social", campaign: "fall-tiktok" };
    const { o: o1 } = await placeOrder(s, ITEMS1, { utm });
    await placeOrder(s, ITEMS1, { utm }); // created, never paid
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${o1.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    await placeOrder(s, ITEMS1, { utm: { source: "Jane Doe", campaign: "jane@example.com" } });
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders WHERE utm_source LIKE '%jane%' OR utm_campaign LIKE '%@%'").get().n, 0);

    let k = (await a.get("/api/admin/marketing")).json.report.campaigns.find(c => c.id === id);
    assert.deepEqual(k.tracked, { sessions: 2, visitors: 2, product_views: 1, add_to_cart: 1, begin_checkout: 0 });
    assert.equal(k.orders_created, 2); assert.equal(k.paid_orders, 1); assert.equal(k.revenue_cents, 7499);
    assert.equal(k.cac_cents, null, "no spend recorded: no cost per customer");
    assert.equal(k.contribution_before_ads_cents, 7499 - 2724 - 1500 - 235);
    await a.post(`/api/admin/marketing/campaigns/${id}`, { spend: "50" });
    k = (await a.get("/api/admin/marketing")).json.report.campaigns.find(c => c.id === id);
    assert.equal(k.cac_cents, 5000); assert.equal(k.roas, 1.5);
    assert.equal(k.profit_after_spend_cents, 7499 - 2724 - 1500 - 235 - 5000);
    assert.ok(!k.flags.some(f => /No ad spend/.test(f)));
    // Ad spend also recorded on the order → double-count warning
    await a.post(`/api/admin/orders/${o1.id}/costs`, { adSpend: "5" });
    k = (await a.get("/api/admin/marketing")).json.report.campaigns.find(c => c.id === id);
    assert.ok(k.flags.some(f => /counting them twice/.test(f)));
    assert.equal(k.profit_after_spend_cents, 7499 - 2724 - 1500 - 235 - 5000, "order-level ads are not subtracted twice");
  } finally { s.close(); }
});

test("M7. margin calculation: $42.24 reference, discounts, fees, ads, break-even", async () => {
  const settings = { product_cost_usd: "27.24", shipping_cost_usd: "15.00", payment_fee_percent: "0", payment_fee_fixed_usd: "0" };
  const base = unitEconomics({ priceCents: 7499, settings });
  assert.equal(base.product_cost_cents + base.shipping_cost_cents, 4224);
  assert.equal(base.profit_cents, 3275); assert.equal(base.break_even_ad_cents, 3275); assert.equal(base.fee_configured, false);
  const r = unitEconomics({ priceCents: 7499, discountCents: 750, adPerOrderCents: 1500, otherCents: 100,
    settings: { ...settings, payment_fee_percent: "3", payment_fee_fixed_usd: "0.25" } });
  assert.equal(r.charged_cents, 6749); assert.equal(r.payment_fee_cents, 202 + 25);
  assert.equal(r.profit_before_ads_cents, 6749 - 4224 - 227 - 100); assert.equal(r.profit_cents, r.profit_before_ads_cents - 1500);
  const s = await startStore();
  try {
    const a = await admin(s);
    const api = (await a.post("/api/admin/marketing/unit-economics", { discount: "7.50", adPerOrder: "15" })).json;
    assert.equal(api.charged_cents, 6749); assert.equal(api.profit_cents, 6749 - 4224 - 1500);
    assert.equal((await a.post("/api/admin/marketing/unit-economics", { adPerOrder: "-1" })).status, 400);
  } finally { s.close(); }
});

test("M8. SEO and Merchant feed only publish verified information", async () => {
  const s = await startStore({ PUBLIC_URL: "https://shop.example.com" });
  try {
    const page = (await s.req("GET", "/product")).text;
    assert.match(page, /<link rel="canonical" href="https:\/\/shop\.example\.com\/product">/);
    assert.match(page, /<meta property="og:image" content="https:\/\/shop\.example\.com\/images\/og-product\.jpg">/);
    assert.match(page, /<title>USB Heated Throw Blanket/);
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    assert.equal(ld["@type"], "Product"); assert.equal(ld.offers.price, "74.99"); assert.equal(ld.offers.priceCurrency, "USD");
    assert.equal(ld.offers.availability, "https://schema.org/InStock");
    for (const forbidden of ["aggregateRating", "review", "deliveryTime", "award", "gtin"]) assert.equal(JSON.stringify(ld).includes(forbidden), false, forbidden);
    assert.equal(ld.offers.hasMerchantReturnPolicy.merchantReturnDays, 30);
    assert.match((await s.req("GET", "/checkout")).text, /noindex/);
    assert.match((await s.req("GET", "/")).text, /"@type":"Organization"/);
    assert.match((await s.req("GET", "/robots.txt")).text, /Disallow: \/admin[\s\S]*Sitemap: https:\/\/shop\.example\.com\/sitemap\.xml/);
    const sm = (await s.req("GET", "/sitemap.xml")).text;
    assert.match(sm, /<loc>https:\/\/shop\.example\.com\/product<\/loc>/); assert.doesNotMatch(sm, /checkout|admin/);
    const feed = (await s.req("GET", "/feeds/google-merchant.xml")).text;
    assert.match(feed, /<g:price>74\.99 USD<\/g:price>/); assert.match(feed, /<g:identifier_exists>no<\/g:identifier_exists>/);
    assert.match(feed, /HL-THROW-camel-brown/); assert.doesNotMatch(feed, /pearl-white/, "unavailable colors are not listed");
    for (const img of ["/images/og-product.jpg", "/images/og-default.jpg", "/images/throw-lifestyle.webp", "/images/throw-texture-800.webp"]) {
      const r = await s.req("GET", img); assert.equal(r.status, 200, img); assert.match(r.headers.get("cache-control"), /max-age=604800/);
    }
  } finally { s.close(); }
  const v = await startStore({ PUBLIC_URL: "https://shop.example.com", DELIVERY_ESTIMATE_VERIFIED: "true" });
  try { assert.match((await v.req("GET", "/product")).text, /"deliveryTime"/, "delivery time only once verified"); } finally { v.close(); }
  const n = await startStore({ PUBLIC_URL: "" });
  try { assert.equal((await n.req("GET", "/feeds/google-merchant.xml")).status, 503); } finally { n.close(); }
  assert.equal(load({}).paymentMethods.length, 3);
});

test("M9. Google site verification tag is injected only when a valid token is set", async () => {
  const s = await startStore({ GOOGLE_SITE_VERIFICATION: "abcDEF123_-xyz789" });
  try { assert.match((await s.req("GET", "/")).text, /<meta name="google-site-verification" content="abcDEF123_-xyz789">/); } finally { s.close(); }
  const bad = await startStore({ GOOGLE_SITE_VERIFICATION: '"><script>alert(1)</script>' });
  try { assert.doesNotMatch((await bad.req("GET", "/")).text, /google-site-verification/); } finally { bad.close(); }
});
