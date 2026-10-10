// End-to-end API tests with an in-memory database and a fake iyzico client.
// Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const iyzico = require("../src/iyzico");
const auth = require("../src/auth");
const { orderProfit, referenceUnitCostCents, dashboard } = require("../src/profit");

const SECRET = "sandbox-secret-key";
const PASSWORD = "correct horse battery staple";

// ---------------------------------------------------------------- fake iyzico
function fakeIyzico() {
  const state = { sessions: {}, n: 0, mode: "success", refunds: [], refundFails: false, retrieveCalls: 0 };
  state.client = {
    checkoutFormInitialize: { create(req, cb) {
      const token = `tok-${++state.n}`;
      state.sessions[token] = req;
      cb(null, { status: "success", token, paymentPageUrl: `https://sandbox-cpp.iyzipay.com?token=${token}` });
    } },
    checkoutForm: { retrieve(req, cb) {
      state.retrieveCalls++;
      if (state.mode === "network") return cb(new Error("ECONNRESET"));
      const s = state.sessions[req.token];
      if (!s) return cb(null, { status: "failure", errorMessage: "unknown token" });
      const base = { status: "success", token: req.token, basketId: s.basketId, conversationId: s.conversationId, currency: s.currency, price: s.price,
        paymentId: `PAY-${req.token}`, fraudStatus: 1, iyziCommissionRateAmount: "2.10", iyziCommissionFee: "0.25" };
      if (state.mode === "success") return cb(null, { ...base, paymentStatus: "SUCCESS", paidPrice: s.paidPrice });
      if (state.mode === "declined") return cb(null, { ...base, paymentStatus: "FAILURE", errorMessage: "Card declined" });
      if (state.mode === "underpaid") return cb(null, { ...base, paymentStatus: "SUCCESS", paidPrice: "1.00" });
      if (state.mode === "fraud_review") return cb(null, { ...base, paymentStatus: "SUCCESS", paidPrice: s.paidPrice, fraudStatus: 0 });
      cb(null, { status: "failure", errorMessage: "unexpected" });
    } },
    refundV2: { create(req, cb) {
      if (state.refundFails) return cb(null, { status: "failure", errorMessage: "Refund not allowed" });
      state.refunds.push(req);
      cb(null, { status: "success", paymentId: req.paymentId, paymentTransactionId: `RT-${state.refunds.length}` });
    } },
  };
  return state;
}

// ---------------------------------------------------------------- harness
async function startStore(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-test-"));
  const cfg = load({
    DB_PATH: path.join(dir, "store.sqlite"),
    ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: auth.hashPassword(PASSWORD),
    IYZICO_API_KEY: "sandbox-api-key", IYZICO_SECRET_KEY: SECRET, IYZICO_URI: "https://sandbox-api.iyzipay.com",
    PUBLIC_URL: "http://127.0.0.1", STORE_PRICE_USD: "74.99", ...env,
  });
  const db = open(cfg.dbPath);
  const fake = fakeIyzico();
  iyzico.setClientForTests(fake.client);
  const silent = { log() {}, warn() {}, error() {} };
  const app = createApp({ cfg, db, log: silent });
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const store = {
    cfg, db, fake, base, dir,
    async req(method, p, body, headers = {}) {
      const r = await fetch(base + p, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* html/redirect */ }
      return { status: r.status, json, text, headers: r.headers };
    },
    async login() {
      const r = await fetch(base + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "owner", password: PASSWORD }) });
      assert.equal(r.status, 200);
      const cookie = r.headers.get("set-cookie").split(";")[0];
      const { csrf } = await r.json();
      return { Cookie: cookie, "X-CSRF-Token": csrf };
    },
    close() { server.close(); db.close(); iyzico.setClientForTests(null); fs.rmSync(dir, { recursive: true, force: true }); },
  };
  return store;
}

const CUSTOMER = { name: "Jane Doe", email: "Jane@Example.com", phone: "+1 512 555 0100", address1: "100 Congress Ave", address2: "Apt 4", city: "Austin", state: "TX", postalCode: "78701" };

async function placeOrder(s, items = [{ variantId: "camel-brown", quantity: 1 }], extra = {}) {
  const r = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items, ...extra });
  assert.equal(r.status, 201, r.text);
  const o = s.db.prepare("SELECT * FROM orders WHERE order_number=?").get(r.json.orderNumber);
  return { r, o };
}

const signedWebhook = (o, overrides = {}) => {
  const body = { paymentConversationId: o.order_number, merchantId: "123", token: o.iyzico_token, status: "SUCCESS",
    iyziReferenceCode: `ref-${o.id}`, iyziEventType: "CHECKOUT_FORM_AUTH", iyziEventTime: Date.now(), iyziPaymentId: 987654, ...overrides };
  return { body, signature: iyzico.webhookSignature(SECRET, body) };
};

async function paidOrder(s, items) {
  const { o } = await placeOrder(s, items);
  const cb = await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
  assert.equal(cb.status, 303);
  return s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id);
}

// ---------------------------------------------------------------- 1. order creation
test("1. creates a pending order with server-side totals and opens iyzico", async () => {
  const s = await startStore();
  try {
    const { r, o } = await placeOrder(s, [{ variantId: "camel-brown", quantity: 2, price: 1 }], { total: 0.01 });
    assert.equal(r.json.mode, "sandbox");
    assert.match(r.json.paymentPageUrl, /^https:\/\/sandbox-cpp\.iyzipay\.com/);
    assert.equal(o.payment_status, "pending");
    assert.equal(o.total_cents, 14998, "client-supplied prices are ignored");
    assert.equal(o.customer_email, "jane@example.com");
    assert.equal(o.est_product_cost_cents, 5448);
    assert.equal(o.est_shipping_cost_cents, 3000);
    const sent = s.fake.sessions[o.iyzico_token];
    assert.equal(sent.price, "149.98");
    assert.equal(sent.currency, "USD");
    assert.equal(sent.basketId, o.order_number);
    assert.equal(sent.callbackUrl, "http://127.0.0.1/api/checkout/iyzico/callback");

    for (const [items, msg] of [
      [[{ variantId: "pearl-white", quantity: 1 }], /not available/],
      [[{ variantId: "gold", quantity: 1 }], /Unknown product/],
      [[{ variantId: "camel-brown", quantity: 9 }], /Maximum 5/],
      [[], /cart is empty/],
    ]) {
      const bad = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items });
      assert.equal(bad.status, 400); assert.match(bad.json.error, msg);
    }
    const badZip = await s.req("POST", "/api/checkout", { customer: { ...CUSTOMER, postalCode: "ABCDE" }, items: [{ variantId: "camel-brown", quantity: 1 }] });
    assert.equal(badZip.status, 400);
    const badState = await s.req("POST", "/api/checkout", { customer: { ...CUSTOMER, state: "ZZ" }, items: [{ variantId: "camel-brown", quantity: 1 }] });
    assert.equal(badState.status, 400);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 2. confirmed by authenticated notification
test("2. a signed webhook confirms payment via iyzico's API; admin is notified", async () => {
  const s = await startStore();
  try {
    const { o } = await placeOrder(s);
    const { body, signature } = signedWebhook(o);
    const r = await s.req("POST", "/api/webhooks/iyzico", body, { "X-IYZ-SIGNATURE-V3": signature });
    assert.equal(r.status, 200);
    const paid = s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id);
    assert.equal(paid.payment_status, "paid");
    assert.equal(paid.paid_cents, 7499);
    assert.equal(paid.iyzico_payment_id, `PAY-${o.iyzico_token}`);
    assert.equal(paid.fee_actual_cents, 235);
    const n = s.db.prepare("SELECT * FROM notifications WHERE order_id=?").all(o.id);
    assert.equal(n.length, 1); assert.match(n[0].title, /New paid order/);

    // Status page: details only with the signed key from the redirect
    const { o: o2 } = await placeOrder(s);
    const cb = await s.req("POST", "/api/checkout/iyzico/callback", `token=${o2.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(cb.status, 303);
    const loc = cb.headers.get("location");
    assert.doesNotMatch(loc, /@/, "no email address in the redirect URL");
    const k = new URL(loc, s.base).searchParams.get("k");
    const pub = await s.req("GET", `/api/orders/${o2.order_number}/status`);
    assert.equal(pub.json.payment_status, "paid"); assert.equal(pub.json.items, undefined);
    const own = await s.req("GET", `/api/orders/${o2.order_number}/status?k=${k}`);
    assert.equal(own.json.items[0].variant, "Camel Brown");
  } finally { s.close(); }
});

test("2b. declined, underpaid and fraud-review payments are never marked paid", async () => {
  const s = await startStore();
  try {
    for (const [mode, expected] of [["declined", "failed"], ["underpaid", "pending"], ["fraud_review", "pending"]]) {
      s.fake.mode = mode;
      const { o } = await placeOrder(s);
      await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
      assert.equal(s.db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o.id).payment_status, expected, mode);
    }
    // A forged callback token does nothing
    const r = await s.req("POST", "/api/checkout/iyzico/callback", "token=forged", { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(r.status, 303); assert.match(r.headers.get("location"), /result=unknown/);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 3. invalid webhook
test("3. webhooks with an invalid or missing signature are rejected", async () => {
  const s = await startStore();
  try {
    const { o } = await placeOrder(s);
    const { body, signature } = signedWebhook(o);
    const tampered = await s.req("POST", "/api/webhooks/iyzico", { ...body, status: "SUCCESS", token: o.iyzico_token, iyziPaymentId: 1 }, { "X-IYZ-SIGNATURE-V3": signature });
    assert.equal(tampered.status, 401);
    const missing = await s.req("POST", "/api/webhooks/iyzico", body);
    assert.equal(missing.status, 401);
    const wrongKey = await s.req("POST", "/api/webhooks/iyzico", body, { "X-IYZ-SIGNATURE-V3": iyzico.webhookSignature("other-secret", body) });
    assert.equal(wrongKey.status, 401);
    assert.equal(s.db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o.id).payment_status, "pending");
    assert.equal(s.fake.retrieveCalls, 0, "a rejected webhook never triggers anything");
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 4. duplicates
test("4. repeated webhooks and callbacks create no duplicates", async () => {
  const s = await startStore();
  try {
    const { o } = await placeOrder(s);
    const { body, signature } = signedWebhook(o);
    for (let i = 0; i < 3; i++) assert.equal((await s.req("POST", "/api/webhooks/iyzico", body, { "X-IYZ-SIGNATURE-V3": signature })).status, 200);
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    await s.req("POST", "/api/checkout/iyzico/callback", `token=${o.iyzico_token}`, { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM webhook_events").get().n, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND event='payment_verified'").get(o.id).n, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM notifications WHERE order_id=?").get(o.id).n, 1);
    assert.equal(s.db.prepare("SELECT paid_cents FROM orders WHERE id=?").get(o.id).paid_cents, 7499);

    // If iyzico can't be reached, the webhook is not swallowed: 500, and the retry works
    const { o: o2 } = await placeOrder(s);
    const w = signedWebhook(o2);
    s.fake.mode = "network";
    assert.equal((await s.req("POST", "/api/webhooks/iyzico", w.body, { "X-IYZ-SIGNATURE-V3": w.signature })).status, 500);
    s.fake.mode = "success";
    assert.equal((await s.req("POST", "/api/webhooks/iyzico", w.body, { "X-IYZ-SIGNATURE-V3": w.signature })).status, 200);
    assert.equal(s.db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o2.id).payment_status, "paid");
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 5. admin protection
test("5. admin routes are protected server-side (auth + CSRF + origin)", async () => {
  const s = await startStore();
  try {
    const o = await paidOrder(s);
    for (const [m, p] of [["GET", "/api/admin/orders"], ["GET", `/api/admin/orders/${o.id}`], ["GET", "/api/admin/dashboard"], ["GET", "/api/admin/backup"],
      ["POST", `/api/admin/orders/${o.id}/refund`], ["POST", `/api/admin/orders/${o.id}/supplier-text`]]) {
      assert.equal((await s.req(m, p, m === "POST" ? {} : undefined)).status, 401, `${m} ${p}`);
    }
    const page = await s.req("GET", "/admin"); assert.equal(page.status, 302);
    const direct = await s.req("GET", "/admin.html"); assert.equal(direct.status, 302);
    assert.equal((await s.req("POST", "/api/admin/login", { username: "owner", password: "wrong" })).status, 401);
    assert.equal((await s.req("POST", "/api/admin/login", { username: "admin", password: PASSWORD })).status, 401);
    const forged = await s.req("GET", `/api/admin/orders/${o.id}`, undefined, { Cookie: "hl_admin=" + "a".repeat(64) });
    assert.equal(forged.status, 401);

    const h = await s.login();
    assert.equal((await s.req("GET", "/api/admin/orders", undefined, { Cookie: h.Cookie })).status, 200);
    const noCsrf = await s.req("POST", `/api/admin/orders/${o.id}/notes`, { notes: "x" }, { Cookie: h.Cookie });
    assert.equal(noCsrf.status, 403);
    const crossOrigin = await s.req("POST", `/api/admin/orders/${o.id}/notes`, { notes: "x" }, { ...h, Origin: "https://evil.example" });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/notes`, { notes: "ok" }, h)).status, 200);
    const sessionRow = s.db.prepare("SELECT token_hash FROM admin_sessions").get();
    assert.notEqual(sessionRow.token_hash, h.Cookie.split("=")[1], "only a hash of the session token is stored");
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='notes_updated'").get().n >= 1);
    assert.equal((await s.req("POST", "/api/admin/logout", {}, h)).status, 200);
    assert.equal((await s.req("GET", "/api/admin/orders", undefined, { Cookie: h.Cookie })).status, 401, "session revoked on logout");
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 6. supplier text
test("6. Copy Supplier Order text contains what the supplier needs and nothing more", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    const { o: unpaid } = await placeOrder(s);
    assert.equal((await s.req("POST", `/api/admin/orders/${unpaid.id}/supplier-text`, {}, h)).status, 409);

    const o = await paidOrder(s, [{ variantId: "camel-brown", quantity: 2 }]);
    const r = await s.req("POST", `/api/admin/orders/${o.id}/supplier-text`, {}, h);
    assert.equal(r.status, 200);
    const t = r.json.text;
    for (const part of [o.order_number, "Product reference:", "Colour / variant: Camel Brown", "Quantity: 2", "Jane Doe", "100 Congress Ave", "Apt 4", "Austin, TX 78701", "United States", "Instructions:"]) {
      assert.ok(t.includes(part), `missing ${part}`);
    }
    for (const forbidden of ["jane@example.com", "555", "PAY-", "74.99", "149.98", "iyzico"]) assert.ok(!t.includes(forbidden), `must not include ${forbidden}`);
    const withPhone = await s.req("POST", `/api/admin/orders/${o.id}/supplier-text`, { includePhone: true }, h);
    assert.match(withPhone.json.text, /Phone \(for the carrier only\): \+1 512 555 0100/);
    assert.equal(s.db.prepare("SELECT fulfillment_status FROM orders WHERE id=?").get(o.id).fulfillment_status, "supplier_order_prepared");
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 7. tracking
test("7. supplier order and tracking are recorded; shipping needs tracking or a justification", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    const o = await paidOrder(s);
    const tooEarly = await s.req("POST", `/api/admin/orders/${o.id}/shipment`, { carrier: "USPS", trackingNumber: "9400" }, h);
    assert.equal(tooEarly.status, 409, "cannot ship before the supplier order");
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "" }, h)).status, 400);
    const sup = await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`,
      { supplierOrderedAt: "2026-10-11", supplierReference: "AE-12345", actualProductCost: "26.90", actualShippingCost: "14.50", supplierConfirmation: "Confirmed by email" }, h);
    assert.equal(sup.status, 200);
    const noTracking = await s.req("POST", `/api/admin/orders/${o.id}/shipment`, { carrier: "USPS" }, h);
    assert.equal(noTracking.status, 400);
    const badUrl = await s.req("POST", `/api/admin/orders/${o.id}/shipment`, { carrier: "USPS", trackingNumber: "9400111", trackingUrl: "javascript:alert(1)" }, h);
    assert.equal(badUrl.status, 400);
    const ship = await s.req("POST", `/api/admin/orders/${o.id}/shipment`,
      { carrier: "USPS", trackingNumber: "9400111899223197428490", trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490", shippedAt: "2026-10-13" }, h);
    assert.equal(ship.status, 200);
    assert.equal(ship.json.email.status, "prepared", "no email provider: prepared, never claimed as sent");
    assert.match(ship.json.email.body, /USPS/); assert.match(ship.json.email.body, /https:\/\/tools\.usps\.com/);
    const row = s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id);
    assert.equal(row.fulfillment_status, "shipped");
    assert.equal(row.supplier_reference, "AE-12345");
    assert.equal(row.actual_product_cost_cents, 2690);
    assert.equal(row.tracking_number, "9400111899223197428490");
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND event='email_prepared'").get(o.id).n, 1);
    // Sending without a provider is refused, not faked
    const send = await s.req("POST", `/api/admin/emails/${ship.json.email.id}/send`, {}, h);
    assert.equal(send.status, 409);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/status`, { status: "delivered", deliveredAt: "2026-10-18" }, h)).status, 200);
    assert.equal(s.db.prepare("SELECT fulfillment_status FROM orders WHERE id=?").get(o.id).fulfillment_status, "delivered");
    // Returns flow
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/status`, { status: "return_requested", note: "Wrong colour" }, h)).status, 200);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/status`, { status: "returned" }, h)).status, 200);

    // Shipping without tracking needs a verified justification
    const o2 = await paidOrder(s);
    await s.req("POST", `/api/admin/orders/${o2.id}/supplier-order`, { supplierReference: "AE-2" }, h);
    const just = await s.req("POST", `/api/admin/orders/${o2.id}/shipment`, { carrier: "Local courier", justification: "Supplier sent dispatch photo and courier receipt #5521" }, h);
    assert.equal(just.status, 200);
  } finally { s.close(); }
});

test("7b. demo orders and unpaid orders can never be fulfilled; demo flow still works", async () => {
  const s = await startStore({ IYZICO_API_KEY: "" });
  try {
    const legacy = await s.req("POST", "/api/demo-order", { ...CUSTOMER, variant: "Camel Brown", quantity: 1 });
    assert.equal(legacy.status, 201); assert.equal(legacy.json.mode, "demo");
    const demo = await s.req("POST", "/api/checkout", { customer: CUSTOMER, items: [{ variantId: "camel-brown", quantity: 1 }] });
    assert.equal(demo.json.mode, "demo"); assert.equal(demo.json.paymentPageUrl, undefined);
    const o = s.db.prepare("SELECT * FROM orders WHERE order_number=?").get(demo.json.orderNumber);
    assert.equal(o.is_test, 1);
    const h = await s.login();
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-text`, {}, h)).status, 409);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "X" }, h)).status, 409);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: 1, mode: "record", requestKey: "abcdefgh1" }, h)).status, 409);
    const d = await s.req("GET", "/api/admin/dashboard", undefined, h);
    assert.equal(d.json.totals.paid_orders, 0); assert.equal(d.json.totals.test_orders, 2);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 8 & 9. profitability
test("8. reference logistics cost is $42.24 for one unit", () => {
  assert.equal(referenceUnitCostCents({ product_cost_usd: "27.24", shipping_cost_usd: "15.00" }), 4224);
});

test("9. profit and margin use actual costs when known, estimates otherwise", () => {
  const o = { is_test: 0, payment_status: "paid", fulfillment_status: "shipped", supplier_ordered_at: "x", paid_cents: 7499, refunded_cents: 0,
    est_product_cost_cents: 2724, est_shipping_cost_cents: 1500, actual_product_cost_cents: null, actual_shipping_cost_cents: null,
    fee_estimated_cents: 0, fee_actual_cents: 235, ad_spend_cents: 1000, other_cost_cents: 50 };
  const p = orderProfit(o);
  assert.equal(p.revenue_cents, 7499);
  assert.equal(p.product_cost.basis, "estimated");
  assert.equal(p.payment_fee.basis, "actual");
  assert.equal(p.profit_cents, 7499 - 2724 - 1500 - 235 - 1000 - 50); // 1990
  assert.equal(p.margin_percent, 26.54);
  const actual = orderProfit({ ...o, actual_product_cost_cents: 2690, actual_shipping_cost_cents: 1450 });
  assert.equal(actual.profit_cents, 7499 - 2690 - 1450 - 235 - 1000 - 50);
  assert.equal(actual.product_cost.basis, "actual");
  // Partial refund only reduces revenue; costs are not double counted
  const refunded = orderProfit({ ...o, payment_status: "partially_refunded", refunded_cents: 2000 });
  assert.equal(refunded.revenue_cents, 5499);
  assert.equal(refunded.profit_cents, 1990 - 2000);
  // Cancelled before the supplier was paid: no product/shipping cost
  const cancelled = orderProfit({ ...o, payment_status: "refunded", refunded_cents: 7499, fulfillment_status: "cancelled", supplier_ordered_at: null, ad_spend_cents: 0, other_cost_cents: 0 });
  assert.equal(cancelled.profit_cents, -235);
  // Unpaid and demo orders don't count
  assert.equal(orderProfit({ ...o, payment_status: "pending" }).counted, false);
  assert.equal(orderProfit({ ...o, is_test: 1 }).counted, false);
  const d = dashboard([o, { ...o, payment_status: "pending" }, { ...o, is_test: 1 }]);
  assert.equal(d.paid_orders, 1); assert.equal(d.pending_orders, 1); assert.equal(d.test_orders, 1);
  assert.equal(d.profit_cents, 1990); assert.equal(d.margin_percent, 26.54);
});

test("9b. editable cost settings feed new orders' estimates and the dashboard", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    assert.equal((await s.req("POST", "/api/admin/settings", { product_cost_usd: "-1" }, h)).status, 400);
    assert.equal((await s.req("POST", "/api/admin/settings", { product_cost_usd: "30", shipping_cost_usd: "12.5", payment_fee_percent: "3" }, h)).status, 200);
    const o = await paidOrder(s);
    assert.equal(o.est_product_cost_cents, 3000); assert.equal(o.est_shipping_cost_cents, 1250); assert.equal(o.fee_estimated_cents, 225);
    await s.req("POST", `/api/admin/orders/${o.id}/costs`, { adSpend: "5", otherCost: "1" }, h);
    const d = await s.req("GET", "/api/admin/dashboard", undefined, h);
    assert.equal(d.json.referenceUnitCostCents, 4250);
    assert.equal(d.json.totals.revenue_cents, 7499);
    assert.equal(d.json.totals.profit_cents, 7499 - 3000 - 1250 - 235 - 500 - 100);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 10. refunds
test("10. refunds: partial then full through iyzico, idempotent, bounded", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    const o = await paidOrder(s);
    const r1 = await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "20.00", mode: "iyzico", reason: "Late delivery", requestKey: "req-0000001" }, h);
    assert.equal(r1.status, 200); assert.equal(r1.json.payment_status, "partially_refunded");
    assert.equal(s.fake.refunds[0].paymentId, `PAY-${o.iyzico_token}`); assert.equal(s.fake.refunds[0].price, "20.00");
    const dup = await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "20.00", mode: "iyzico", requestKey: "req-0000001" }, h);
    assert.equal(dup.json.duplicate, true); assert.equal(s.fake.refunds.length, 1, "same request key never refunds twice");
    const tooMuch = await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "60.00", mode: "iyzico", requestKey: "req-0000002" }, h);
    assert.equal(tooMuch.status, 400);
    s.fake.refundFails = true;
    const refused = await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "1.00", mode: "iyzico", requestKey: "req-0000003" }, h);
    assert.equal(refused.status, 502);
    assert.equal(s.db.prepare("SELECT refunded_cents FROM orders WHERE id=?").get(o.id).refunded_cents, 2000, "a refused refund changes nothing");
    s.fake.refundFails = false;
    const rest = await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "54.99", mode: "record", reason: "Refunded in iyzico panel", requestKey: "req-0000004" }, h);
    assert.equal(rest.json.payment_status, "refunded");
    assert.equal(s.fake.refunds.length, 1, "record mode does not call iyzico");
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/refund`, { amount: "1", mode: "record", requestKey: "req-0000005" }, h)).status, 409);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-text`, {}, h)).status, 409, "fully refunded orders cannot be sent to the supplier");
    const d = await s.req("GET", "/api/admin/dashboard", undefined, h);
    assert.equal(d.json.totals.refunds_cents, 7499); assert.equal(d.json.totals.revenue_cents, 0);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- 12. existing features / security
test("12. pages, live-mode gate, migration and secrets", async () => {
  const s = await startStore();
  try {
    for (const p of ["/", "/product", "/cart", "/checkout", "/faq", "/contact", "/shipping", "/returns", "/privacy", "/terms", "/order-status", "/admin-login.html", "/policies.html"]) {
      assert.equal((await s.req("GET", p)).status, 200, p);
    }
    const cfg = (await s.req("GET", "/api/config")).json;
    assert.equal(JSON.stringify(cfg).includes(SECRET), false); assert.equal(JSON.stringify(cfg).includes("sandbox-api-key"), false);
    assert.equal(cfg.currency, "USD");
    const head = await s.req("GET", "/");
    assert.match(head.headers.get("content-security-policy"), /script-src 'self'/);
    const contact = await s.req("POST", "/api/contact", { name: "Jane", email: "jane@example.com", message: "Where is my parcel?" });
    assert.equal(contact.status, 201);
  } finally { s.close(); }

  const live = load({ IYZICO_API_KEY: "k", IYZICO_SECRET_KEY: "s", PUBLIC_URL: "https://x", IYZICO_URI: "https://api.iyzipay.com" });
  assert.equal(iyzico.checkoutStatus(live).enabled, false, "live keys alone never enable real payments");
  assert.equal(iyzico.checkoutStatus({ ...live, livePaymentsEnabled: true }).enabled, false);
  assert.equal(iyzico.checkoutStatus({ ...live, livePaymentsEnabled: true, productComplianceVerified: true }).mode, "live");

  // A database from the first version is migrated without losing the old rows
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-mig-"));
  const file = path.join(dir, "old.sqlite");
  const old = new Database(file);
  old.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, order_number TEXT); INSERT INTO orders(order_number) VALUES('HL-TEST-OLD'); CREATE TABLE order_events (id INTEGER PRIMARY KEY);");
  old.close();
  const db = open(file);
  assert.equal(db.prepare("SELECT order_number FROM orders_v1_legacy").get().order_number, "HL-TEST-OLD");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n, 0);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
