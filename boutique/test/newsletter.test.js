// E-mail list and welcome code: sign-up validation, abuse limits, the one-use-per-subscriber
// rule at checkout, unsubscribe, admin access and start-up recreation of the welcome promo.
const test = require("node:test");
const assert = require("node:assert/strict");
const notify = require("../src/notify");
const { createApp } = require("../src/app");
const { startStore, placeOrder, CUSTOMER } = require("./helpers");

const ITEMS = [{ variantId: "camel-brown", quantity: 1 }];
const sub = (s, email, extra = {}) => s.req("POST", "/api/newsletter/subscribe", { email, source: "cart", ...extra });
async function paidWith(s, promoCode, email = CUSTOMER.email) {
  const r = await s.req("POST", "/api/checkout", { customer: { ...CUSTOMER, email }, items: ITEMS, promoCode });
  if (r.status !== 201) return r;
  const o = s.db.prepare("SELECT * FROM orders WHERE order_number=?").get(r.json.orderNumber);
  await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
  return { status: 201, order: s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id) };
}

test("N1. sign-up: validation, honeypot, idempotent, minimal data, honest about e-mail", async () => {
  const s = await startStore({ NEWSLETTER_SIGNUP_LIMIT: "50" });
  try {
    const cfg = (await s.req("GET", "/api/config")).json;
    assert.deepEqual(cfg.newsletter, { percent: 10 });
    for (const bad of ["", "nope", "a@b", "x".repeat(250) + "@example.com"]) assert.equal((await sub(s, bad)).status, 400, bad);
    assert.equal((await sub(s, "bot@example.com", { website: "http://spam" })).status, 400, "honeypot");
    const r = await sub(s, "  Jane@Example.com ");
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.code, "WELCOME10"); assert.equal(r.json.percent, 10); assert.equal(r.json.emailed, false, "no provider: never claims an email was sent");
    assert.match(r.json.conditions, /10% off your order subtotal.*One use per subscribed email address, checked at payment\./);
    assert.equal((await sub(s, "jane@example.com")).status, 201, "re-subscribing is fine");
    const rows = s.db.prepare("SELECT * FROM newsletter_subscribers").all();
    assert.equal(rows.length, 1); assert.equal(rows[0].email, "jane@example.com"); assert.equal(rows[0].source, "cart");
    assert.match(rows[0].consent_text, /Unsubscribe anytime/);
    assert.deepEqual(Object.keys(rows[0]).filter(k => /ip/i.test(k)), [], "no IP address stored");
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM emails").get().n, 0, "nothing queued without a provider");
  } finally { s.close(); }
});

test("N2. sign-ups are rate limited per IP", async () => {
  const s = await startStore();
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await sub(s, `p${i}@example.com`)).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
  } finally { s.close(); }
});

test("N3. WELCOME10: 10% once, only for the subscribed e-mail, checked server-side at payment", async () => {
  const s = await startStore();
  try {
    const q = await s.req("POST", "/api/quote", { items: ITEMS, promoCode: "welcome10" });
    assert.equal(q.status, 200); assert.equal(q.json.discount_cents, 750); assert.match(q.json.promo.conditions, /checked at payment/);
    const notSub = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items: ITEMS, promoCode: "WELCOME10" });
    assert.equal(notSub.status, 400); assert.match(notSub.json.error, /reserved for newsletter subscribers/);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM orders").get().n, 0, "no order created");

    await sub(s, CUSTOMER.email);
    const first = await paidWith(s, "WELCOME10");
    assert.equal(first.status, 201);
    assert.equal(first.order.discount_cents, 750); assert.equal(first.order.total_cents, 7499 - 750); assert.equal(first.order.payment_status, "paid");
    assert.equal(s.fake.sessions[first.order.iyzico_token].paidPrice, "67.49", "the discounted amount is what iyzico charges");
    const again = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items: ITEMS, promoCode: "WELCOME10" });
    assert.equal(again.status, 400); assert.match(again.json.error, /already been used/);
    // A pending (unpaid) order doesn't use the code up
    await sub(s, "other@example.com");
    const { o } = await placeOrder(s, ITEMS, { customer: { ...CUSTOMER, email: "other@example.com" }, promoCode: "WELCOME10" });
    assert.equal(o.payment_status, "pending");
    assert.equal((await paidWith(s, "WELCOME10", "other@example.com")).status, 201);
    // Other codes are unaffected by the subscriber rule
    const h = await s.login();
    await s.req("POST", "/api/admin/marketing/promotions", { code: "COZY5", kind: "percent", value: "5", startsAt: new Date(Date.now() - 864e5).toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString() }, h);
    assert.equal((await s.req("POST", "/api/checkout", { customer: { ...CUSTOMER, email: "nobody@example.com" }, items: ITEMS, promoCode: "COZY5" })).status, 201);
  } finally { s.close(); }
});

test("N4. welcome e-mail with a working unsubscribe link (only when a provider is configured)", async () => {
  const sent = [];
  notify.setFetchForTests(async (url, opts) => { if (String(url).includes("resend")) sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: "em_1" }) }; });
  const s = await startStore({ RESEND_API_KEY: "re_test", EMAIL_FROM: "HavenLume <shop@example.com>", STORE_BUSINESS_ADDRESS: "1 Main St, Austin, TX" });
  try {
    const r = await sub(s, CUSTOMER.email);
    assert.equal(r.json.emailed, true);
    const mail = sent.find(m => /welcome/i.test(m.subject));
    assert.match(mail.text, /WELCOME10/); assert.match(mail.text, /1 Main St, Austin, TX/, "postal address in marketing email");
    const token = (mail.text.match(/unsubscribe\?token=([A-Za-z0-9_-]{32})/) || [])[1];
    assert.ok(token);
    assert.equal(s.db.prepare("SELECT body FROM emails WHERE kind='newsletter_welcome'").get().body.includes(token), false, "link not stored");
    assert.equal((await s.req("GET", "/newsletter/unsubscribe?token=bad")).status, 400);
    const u = await s.req("GET", `/newsletter/unsubscribe?token=${token}`);
    assert.equal(u.status, 200); assert.match(u.text, /You're unsubscribed/);
    assert.equal(s.db.prepare("SELECT status FROM newsletter_subscribers").get().status, "unsubscribed");
    assert.equal((await s.req("GET", `/newsletter/unsubscribe?token=${token}`)).status, 400, "single use");
    const after = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items: ITEMS, promoCode: "WELCOME10" });
    assert.equal(after.status, 400, "unsubscribed addresses can't use the code");
  } finally { s.close(); notify.setFetchForTests((...a) => fetch(...a)); }
});

test("N5. admin: protected list, CSV export (formula-safe), delete on request, audited", async () => {
  const s = await startStore({ NEWSLETTER_SIGNUP_LIMIT: "50" });
  try {
    await sub(s, "=cmd@example.com"); await sub(s, "b@example.com");
    for (const [m, p] of [["GET", "/api/admin/newsletter"], ["GET", "/api/admin/newsletter.csv"], ["POST", "/api/admin/newsletter/1/delete"]]) {
      assert.equal((await s.req(m, p, m === "POST" ? {} : undefined)).status, 401, `${m} ${p}`);
    }
    const h = await s.login();
    assert.equal((await s.req("POST", "/api/admin/newsletter/1/delete", {}, { Cookie: h.Cookie })).status, 403, "CSRF");
    const list = (await s.req("GET", "/api/admin/newsletter", undefined, h)).json;
    assert.equal(list.counts.subscribed, 2); assert.equal(list.code, "WELCOME10"); assert.equal(list.codeUses, 0);
    const csv = await s.req("GET", "/api/admin/newsletter.csv", undefined, h);
    assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(csv.text, /^email,status,source/);
    assert.match(csv.text, /\n'=cmd@example\.com,subscribed/, "formula injection neutralised");
    const id = list.subscribers.find(x => x.email === "b@example.com").id;
    assert.equal((await s.req("POST", `/api/admin/newsletter/${id}/delete`, {}, h)).status, 200);
    assert.equal((await s.req("POST", `/api/admin/newsletter/${id}/delete`, {}, h)).status, 404);
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('newsletter_export','newsletter_subscriber_deleted')").get().n >= 2);
  } finally { s.close(); }
});

test("N6. the welcome promo is recreated at start-up; NEWSLETTER_ENABLED=false turns everything off", async () => {
  const s = await startStore();
  try {
    s.db.prepare("DELETE FROM promotions WHERE code='WELCOME10'").run();
    createApp({ cfg: s.cfg, db: s.db, log: { log() {}, warn() {}, error() {} } }); // what a restart does
    const p = s.db.prepare("SELECT * FROM promotions WHERE code='WELCOME10'").get();
    assert.equal(p.kind, "percent"); assert.equal(p.value, 10); assert.equal(p.active, 1); assert.equal(p.max_redemptions, null);
  } finally { s.close(); }
  const off = await startStore({ NEWSLETTER_ENABLED: "false" });
  try {
    assert.equal((await sub(off, "jane@example.com")).status, 404);
    assert.equal((await off.req("GET", "/api/config")).json.newsletter, null);
    assert.equal(off.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='newsletter_subscribers'").get().n, 0, "no table created");
    assert.equal(off.db.prepare("SELECT COUNT(*) n FROM promotions WHERE code='WELCOME10'").get().n, 0);
    assert.equal((await off.req("POST", "/api/checkout", { customer: CUSTOMER, items: ITEMS, promoCode: "WELCOME10" })).status, 400);
  } finally { off.close(); }
});
