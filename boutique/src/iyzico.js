// iyzico integration: hosted Checkout Form, payment retrieval, webhook signature (V3),
// refunds. Payment truth always comes from iyzico's authenticated API, never from the
// customer's browser.
const crypto = require("crypto");
const Iyzipay = require("iyzipay");

let injectedClient = null; // tests inject a fake client
let client = null;
let clientKey = "";

function setClientForTests(fake) { injectedClient = fake; }

function getClient(cfg) {
  if (injectedClient) return injectedClient;
  const key = `${cfg.iyzico.apiKey}|${cfg.iyzico.uri}`;
  if (!client || key !== clientKey) {
    client = new Iyzipay({ apiKey: cfg.iyzico.apiKey, secretKey: cfg.iyzico.secretKey, uri: cfg.iyzico.uri });
    clientKey = key;
  }
  return client;
}

const call = (resource, request) => new Promise((resolve, reject) =>
  resource.create ? resource.create(request, (e, r) => e ? reject(e) : resolve(r)) : reject(new Error("bad resource")));
const callRetrieve = (resource, request) => new Promise((resolve, reject) =>
  resource.retrieve(request, (e, r) => e ? reject(e) : resolve(r)));

const isSandbox = (cfg) => /sandbox/i.test(cfg.iyzico.uri);

// Sandbox works once keys are set. Real money stays blocked until the owner confirms
// both live payments and the product compliance review.
function checkoutStatus(cfg) {
  if (!cfg.iyzico.apiKey || !cfg.iyzico.secretKey || !cfg.publicUrl) {
    return { enabled: false, mode: "demo", reason: "iyzico keys or PUBLIC_URL not configured." };
  }
  if (isSandbox(cfg)) return { enabled: true, mode: "sandbox" };
  if (!cfg.livePaymentsEnabled || !cfg.productComplianceVerified) {
    return { enabled: false, mode: "demo", reason: "Live iyzico keys set, but LIVE_PAYMENTS_ENABLED and PRODUCT_COMPLIANCE_VERIFIED are not both true." };
  }
  return { enabled: true, mode: "live" };
}

const money = (c) => (c / 100).toFixed(2);

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return { name: parts[0], surname: parts[0] };
  return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

/** Opens a hosted payment page for an order. Returns { token, paymentPageUrl }. */
async function initializeCheckout(cfg, order, items, buyerIp) {
  const { name, surname } = splitName(order.customer_name);
  const address = [order.address1, order.address2, `${order.city}, ${order.state} ${order.postal_code}`].filter(Boolean).join(", ");
  const country = order.country === "US" ? "United States" : order.country;
  const place = { contactName: order.customer_name, city: order.city, country, address, zipCode: order.postal_code };
  const basketItems = items.map((it) => ({
    id: `${it.sku}-${it.variant_id}`, name: `${it.product_name} - ${it.variant_name} x${it.quantity}`,
    category1: "Home", itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL, price: money(it.line_total_cents),
  }));
  if (order.shipping_cents > 0) {
    basketItems.push({ id: "SHIPPING", name: "Shipping", category1: "Shipping", itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL, price: money(order.shipping_cents) });
  }
  const request = {
    locale: Iyzipay.LOCALE.EN,
    conversationId: order.order_number,
    price: money(order.total_cents), paidPrice: money(order.total_cents),
    currency: order.currency,
    basketId: order.order_number,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: `${cfg.publicUrl}/api/checkout/iyzico/callback`,
    enabledInstallments: [1],
    buyer: {
      id: order.order_number, name, surname, email: order.customer_email,
      ...(order.customer_phone ? { gsmNumber: order.customer_phone } : {}),
      // iyzico requires an identity number; confirm with iyzico what to send for
      // non-Turkish buyers before going live (IYZICO_BUYER_IDENTITY_NUMBER).
      identityNumber: cfg.iyzico.buyerIdentityNumber,
      registrationAddress: address, city: order.city, country, zipCode: order.postal_code,
      ip: String(buyerIp || "127.0.0.1").replace(/^::ffff:/, ""),
    },
    shippingAddress: place,
    billingAddress: place,
    basketItems,
  };
  const r = await call(getClient(cfg).checkoutFormInitialize, request);
  if (!r || r.status !== "success" || !r.token || !r.paymentPageUrl) {
    throw new Error(`iyzico: ${r?.errorMessage || "checkout initialization refused"}`);
  }
  return { token: r.token, paymentPageUrl: r.paymentPageUrl };
}

function retrieveCheckout(cfg, token) {
  return callRetrieve(getClient(cfg).checkoutForm, { locale: Iyzipay.LOCALE.EN, token });
}

/**
 * Interprets an iyzico retrieve result for `order`.
 * Returns { outcome: "paid" | "failed" | "pending", reason, paymentId, paidCents, feeCents }.
 */
function evaluatePayment(r, order) {
  if (!r || r.status !== "success") return { outcome: "pending", reason: r?.errorMessage || "iyzico lookup failed." };
  if (r.token && r.token !== order.iyzico_token) return { outcome: "pending", reason: "Token does not match this order." };
  if (r.basketId !== order.order_number) return { outcome: "pending", reason: "Basket ID does not match this order." };
  if (r.paymentStatus === "FAILURE") return { outcome: "failed", reason: r.errorMessage || "Payment declined." };
  if (r.paymentStatus !== "SUCCESS") return { outcome: "pending", reason: `Payment status: ${r.paymentStatus || "unknown"}.` };
  if (String(r.currency || "").toUpperCase() !== order.currency) return { outcome: "pending", reason: "Currency mismatch — review manually." };
  const paidCents = Math.round(Number(r.paidPrice) * 100);
  if (!Number.isFinite(paidCents) || paidCents < order.total_cents) return { outcome: "pending", reason: "Paid amount is lower than the order total — review manually." };
  // fraudStatus: 1 = approved, 0 = under review, -1 = rejected (iyzico).
  if (r.fraudStatus !== undefined && Number(r.fraudStatus) !== 1) return { outcome: "pending", reason: `iyzico fraud status ${r.fraudStatus} — do not ship until iyzico approves.` };
  const fee = Number(r.iyziCommissionRateAmount || 0) + Number(r.iyziCommissionFee || 0);
  return { outcome: "paid", paymentId: String(r.paymentId || ""), paidCents, feeCents: fee > 0 ? Math.round(fee * 100) : null };
}

/**
 * Verifies X-IYZ-SIGNATURE-V3 for Checkout Form webhooks:
 * hex(HMAC-SHA256(secretKey, secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status))
 * Direct-payment format (no token): secretKey + iyziEventType + paymentId + paymentConversationId + status.
 */
function webhookSignature(secretKey, b) {
  const data = b.token !== undefined && b.token !== null && b.token !== ""
    ? `${secretKey}${b.iyziEventType}${b.iyziPaymentId}${b.token}${b.paymentConversationId}${b.status}`
    : `${secretKey}${b.iyziEventType}${b.paymentId}${b.paymentConversationId}${b.status}`;
  return crypto.createHmac("sha256", secretKey).update(data).digest("hex");
}

function verifyWebhookSignature(cfg, body, header) {
  if (!header || !cfg.iyzico.secretKey) return false;
  const expected = Buffer.from(webhookSignature(cfg.iyzico.secretKey, body));
  const got = Buffer.from(String(header).trim().toLowerCase());
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

/** Refunds `cents` of a payment through iyzico (Refund V2, by paymentId). */
async function refund(cfg, order, cents, ip) {
  const r = await call(getClient(cfg).refundV2, {
    locale: Iyzipay.LOCALE.EN, conversationId: `${order.order_number}-R${Date.now()}`,
    paymentId: order.iyzico_payment_id, price: money(cents), currency: order.currency,
    ip: String(ip || "127.0.0.1").replace(/^::ffff:/, ""),
  });
  if (!r || r.status !== "success") throw new Error(`iyzico refund refused: ${r?.errorMessage || "unknown error"}`);
  return { providerRef: String(r.paymentTransactionId || r.paymentId || "") };
}

module.exports = { checkoutStatus, initializeCheckout, retrieveCheckout, evaluatePayment, verifyWebhookSignature, webhookSignature, refund, setClientForTests };
