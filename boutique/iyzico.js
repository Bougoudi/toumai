// iyzico hosted payment page ("Checkout Form").
// Flow: initialize -> customer pays on iyzico's page -> iyzico posts a token to our
// callback -> we RETRIEVE the payment from iyzico's API (source of truth) and only
// then mark the order paid. The browser redirect itself is never trusted.
const Iyzipay = require("iyzipay");

const cfg = () => ({
  apiKey: process.env.IYZICO_API_KEY || "",
  secretKey: process.env.IYZICO_SECRET_KEY || "",
  uri: process.env.IYZICO_URI || "https://sandbox-api.iyzipay.com",
});

const configured = () => Boolean(cfg().apiKey && cfg().secretKey && process.env.PUBLIC_URL);
const isSandbox = () => /sandbox/i.test(cfg().uri);

// Sandbox is always allowed once keys are set. Real money (api.iyzipay.com) stays
// blocked until the owner explicitly confirms live payments AND product compliance.
function checkoutStatus() {
  if (!configured()) return { enabled: false, reason: "iyzico keys or PUBLIC_URL not configured." };
  if (isSandbox()) return { enabled: true, sandbox: true };
  if (process.env.LIVE_PAYMENTS_ENABLED !== "true" || process.env.PRODUCT_COMPLIANCE_VERIFIED !== "true") {
    return { enabled: false, reason: "Live iyzico keys set, but LIVE_PAYMENTS_ENABLED / PRODUCT_COMPLIANCE_VERIFIED are not both true." };
  }
  return { enabled: true, sandbox: false };
}

let client = null;
let clientKey = "";
function iyzipay() {
  const c = cfg(); const key = `${c.apiKey}|${c.uri}`;
  if (!client || key !== clientKey) { client = new Iyzipay(c); clientKey = key; }
  return client;
}

const call = (fn, request) => new Promise((resolve, reject) => fn(request, (err, result) => err ? reject(err) : resolve(result)));

function splitName(full) {
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 1) return { name: parts[0], surname: parts[0] };
  return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

/** Creates the hosted payment page for an order row. Returns { token, paymentPageUrl }. */
async function initializeCheckout(order, buyerIp) {
  const price = order.customer_total.toFixed(2);
  const { name, surname } = splitName(order.customer_name);
  const address = [order.address1, order.address2, `${order.state} ${order.postal_code}`].filter(Boolean).join(", ");
  const place = { contactName: order.customer_name, city: order.city, country: order.country, address, zipCode: order.postal_code };
  const request = {
    locale: Iyzipay.LOCALE.EN,
    conversationId: order.order_number,
    price, paidPrice: price,
    currency: order.currency,
    basketId: order.order_number,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl: `${process.env.PUBLIC_URL.replace(/\/$/, "")}/api/checkout/iyzico/callback`,
    enabledInstallments: [1],
    buyer: {
      id: order.order_number, name, surname, email: order.customer_email,
      ...(order.customer_phone ? { gsmNumber: order.customer_phone } : {}),
      // iyzico requires an identity number. Turkish buyers use their TC Kimlik No;
      // confirm with iyzico what to send for foreign buyers before going live.
      identityNumber: process.env.IYZICO_BUYER_IDENTITY_NUMBER || "11111111111",
      registrationAddress: address, city: order.city, country: order.country, zipCode: order.postal_code,
      ip: String(buyerIp || "127.0.0.1").replace(/^::ffff:/, ""),
    },
    shippingAddress: place,
    billingAddress: place,
    basketItems: [{
      id: "HL-THROW", name: `${order.product_name} - ${order.variant} x${order.quantity}`,
      category1: "Home", itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL, price,
    }],
  };
  const result = await call((r, cb) => iyzipay().checkoutFormInitialize.create(r, cb), request);
  if (result.status !== "success" || !result.token || !result.paymentPageUrl) {
    throw new Error(`iyzico: ${result.errorMessage || "checkout initialization refused."}`);
  }
  return { token: result.token, paymentPageUrl: result.paymentPageUrl };
}

/** Reads the payment for a checkout token directly from iyzico's API. */
function retrieveCheckout(token) {
  return call((r, cb) => iyzipay().checkoutForm.retrieve(r, cb), { locale: Iyzipay.LOCALE.EN, token });
}

/**
 * Decides whether an iyzico retrieve result proves that `order` was paid in full.
 * Returns { paid: true, paymentId } or { paid: false, reason }.
 */
function verifyPayment(result, order) {
  if (!result || result.status !== "success") return { paid: false, reason: result?.errorMessage || "iyzico lookup failed." };
  if (result.paymentStatus !== "SUCCESS") return { paid: false, reason: `Payment status: ${result.paymentStatus || "unknown"}.` };
  if (result.token !== order.iyzico_token) return { paid: false, reason: "Token does not match this order." };
  if (result.basketId !== order.order_number) return { paid: false, reason: "Basket does not match this order." };
  if (String(result.currency).toUpperCase() !== order.currency) return { paid: false, reason: "Currency mismatch." };
  if (Math.round(Number(result.paidPrice) * 100) < Math.round(order.customer_total * 100)) return { paid: false, reason: "Paid amount is lower than the order total." };
  return { paid: true, paymentId: String(result.paymentId || "") };
}

module.exports = { checkoutStatus, initializeCheckout, retrieveCheckout, verifyPayment };
