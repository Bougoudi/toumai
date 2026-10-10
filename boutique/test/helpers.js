// Shared test harness: in-memory store with a fake iyzico client.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { load } = require("../src/config");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const iyzico = require("../src/iyzico");
const auth = require("../src/auth");

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


module.exports = { SECRET, PASSWORD, CUSTOMER, startStore, placeOrder, signedWebhook, paidOrder, fakeIyzico };
