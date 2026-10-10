// Order domain logic: validation, creation, payment confirmation, refunds,
// fulfillment workflow, supplier text and customer shipment emails.
const crypto = require("crypto");
const { catalog } = require("./catalog");
const { getSettings } = require("./db");
const { toCents, estimateFeeCents, orderProfit, PAID_STATES } = require("./profit");
const iyzico = require("./iyzico");
const notify = require("./notify");

const now = () => new Date().toISOString();
const usd = (c) => `$${(c / 100).toFixed(2)}`;

class OrderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

const str = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/** Validates and normalises checkout input. Throws OrderError(400). */
function validateCheckout(body, cfg) {
  const b = body || {};
  const c = b.customer || b; // the legacy demo form sent flat fields
  const customer = {
    name: str(c.name, 120), email: str(c.email, 254).toLowerCase(), phone: str(c.phone, 30),
    address1: str(c.address1, 200), address2: str(c.address2, 200), city: str(c.city, 100),
    state: str(c.state, 2).toUpperCase(), postalCode: str(c.postalCode, 10), country: "US",
  };
  for (const k of ["name", "email", "address1", "city", "state", "postalCode"]) {
    if (!customer[k]) throw new OrderError(400, `Missing field: ${k}`);
  }
  if (customer.name.length < 2) throw new OrderError(400, "Enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email)) throw new OrderError(400, "Enter a valid email address.");
  if (!US_STATES.includes(customer.state)) throw new OrderError(400, "Choose a valid US state.");
  if (!/^\d{5}(-\d{4})?$/.test(customer.postalCode)) throw new OrderError(400, "Enter a valid US ZIP code.");
  if (customer.phone && !/^\+?[0-9 ()\-.]{7,20}$/.test(customer.phone)) throw new OrderError(400, "Enter a valid phone number.");
  if (c.country && !["US", "USA", "UNITED STATES"].includes(String(c.country).trim().toUpperCase())) {
    throw new OrderError(400, "We currently ship to the United States only.");
  }

  const product = catalog(cfg);
  let rawItems = Array.isArray(b.items) ? b.items : null;
  if (!rawItems && c.variant) { // legacy demo form: one variant by name
    const v = product.variants.find(x => x.name === c.variant || x.id === c.variant);
    rawItems = [{ variantId: v ? v.id : c.variant, quantity: c.quantity }];
  }
  if (!rawItems || rawItems.length === 0) throw new OrderError(400, "Your cart is empty.");
  if (rawItems.length > 10) throw new OrderError(400, "Too many cart lines.");
  const merged = new Map();
  for (const it of rawItems) {
    const variant = product.variants.find(v => v.id === String(it?.variantId || ""));
    if (!variant) throw new OrderError(400, "Unknown product option.");
    if (!variant.available) throw new OrderError(400, `${variant.name} is not available right now.`);
    const qty = Number.parseInt(it.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) throw new OrderError(400, "Invalid quantity.");
    merged.set(variant.id, (merged.get(variant.id) || 0) + qty);
  }
  const items = [...merged.entries()].map(([variantId, quantity]) => {
    if (quantity > product.maxQtyPerLine) throw new OrderError(400, `Maximum ${product.maxQtyPerLine} per colour.`);
    const v = product.variants.find(x => x.id === variantId);
    return { sku: product.sku, supplier_sku: product.supplierSku, product_name: product.name, variant_id: v.id, variant_name: v.name,
      supplier_variant: v.supplierVariant, quantity, unit_price_cents: product.priceCents, line_total_cents: product.priceCents * quantity };
  });
  return { customer, items };
}

/** Creates an order (pending payment). Prices and costs are computed here, server-side. */
function createOrder(db, cfg, { customer, items }, { isTest, ip }) {
  const settings = getSettings(db);
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const subtotal = items.reduce((s, i) => s + i.line_total_cents, 0);
  const shipping = toCents(cfg.shippingUsd);
  const total = subtotal + shipping;
  const orderNumber = (isTest ? "HL-TEST-" : "HL-") + crypto.randomBytes(5).toString("hex").toUpperCase();
  const t = now();
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO orders(order_number,created_at,updated_at,is_test,customer_name,customer_email,customer_phone,
      address1,address2,city,state,postal_code,country,currency,subtotal_cents,shipping_cents,total_cents,payment_status,
      payment_provider,fee_estimated_cents,est_product_cost_cents,est_shipping_cost_cents,customer_ip)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)`).run(
      orderNumber, t, t, isTest ? 1 : 0, customer.name, customer.email, customer.phone || null,
      customer.address1, customer.address2 || null, customer.city, customer.state, customer.postalCode, customer.country, cfg.currency,
      subtotal, shipping, total, isTest ? null : "iyzico", isTest ? 0 : estimateFeeCents(total, settings),
      toCents(settings.product_cost_usd) * units, toCents(settings.shipping_cost_usd) * units, String(ip || "").slice(0, 64),
    ).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO order_items(order_id,sku,supplier_sku,product_name,variant_id,variant_name,supplier_variant,quantity,unit_price_cents,line_total_cents)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const i of items) ins.run(id, i.sku, i.supplier_sku, i.product_name, i.variant_id, i.variant_name, i.supplier_variant, i.quantity, i.unit_price_cents, i.line_total_cents);
    event(db, id, isTest ? "test_order_created" : "order_created", isTest ? "Demo order — no payment collected; cannot be fulfilled." : `Awaiting payment of ${usd(total)}.`);
    return getOrder(db, id);
  })();
}

function event(db, orderId, name, details = "", actor = "system") {
  db.prepare("INSERT INTO order_events(order_id,event,details,actor,created_at) VALUES(?,?,?,?,?)").run(orderId, name, String(details).slice(0, 1000), actor, now());
}

function getOrder(db, id) { return db.prepare("SELECT * FROM orders WHERE id=?").get(id); }
function getItems(db, id) { return db.prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY id").all(id); }

function orderDetail(db, id) {
  const o = getOrder(db, id);
  if (!o) return null;
  return {
    ...o,
    items: getItems(db, id),
    profit: orderProfit(o),
    events: db.prepare("SELECT event,details,actor,created_at FROM order_events WHERE order_id=? ORDER BY id DESC").all(id),
    refunds: db.prepare("SELECT amount_cents,method,provider_ref,reason,actor,created_at FROM refunds WHERE order_id=? ORDER BY id DESC").all(id),
    emails: db.prepare("SELECT id,kind,to_addr,subject,body,status,error,created_at,sent_at FROM emails WHERE order_id=? ORDER BY id DESC").all(id),
  };
}

// ---------------------------------------------------------------- payments

/**
 * Re-reads the payment from iyzico and applies it. Idempotent: callbacks, webhooks and
 * admin re-checks can all call this any number of times.
 */
async function confirmPayment(db, cfg, order, source) {
  if (order.is_test) return { outcome: "test", reason: "Demo order." };
  if (!order.iyzico_token) return { outcome: "pending", reason: "No iyzico checkout for this order." };
  if (PAID_STATES.has(order.payment_status)) return { outcome: "paid", already: true };
  const verdict = iyzico.evaluatePayment(await iyzico.retrieveCheckout(cfg, order.iyzico_token), order);
  if (verdict.outcome === "paid") {
    const t = now();
    const changed = db.prepare(`UPDATE orders SET payment_status='paid', iyzico_payment_id=?, paid_at=?, paid_cents=?, fee_actual_cents=?, updated_at=?
      WHERE id=? AND payment_status IN ('pending','failed')`).run(verdict.paymentId, t, verdict.paidCents, verdict.feeCents, t, order.id).changes;
    if (changed) {
      event(db, order.id, "payment_verified", `iyzico payment ${verdict.paymentId}, ${usd(verdict.paidCents)} (via ${source})`);
      const o = getOrder(db, order.id);
      const items = getItems(db, order.id).map(i => `${i.quantity} × ${i.variant_name}`).join(", ");
      await notify.notifyAdmin(db, cfg, { kind: "new_paid_order", orderId: order.id,
        title: `New paid order ${o.order_number} — ${usd(o.paid_cents)}`,
        body: `${items}\nShip to: ${o.customer_name}, ${o.city}, ${o.state} ${o.postal_code}\nOpen the admin to prepare the supplier order.` });
    }
  } else if (verdict.outcome === "failed") {
    const changed = db.prepare("UPDATE orders SET payment_status='failed', updated_at=? WHERE id=? AND payment_status='pending'").run(now(), order.id).changes;
    if (changed) event(db, order.id, "payment_failed", verdict.reason);
  } else {
    event(db, order.id, "payment_not_confirmed", `${verdict.reason} (via ${source})`);
  }
  return verdict;
}

const refundLocks = new Set();

/**
 * Refunds an order. mode "iyzico" calls iyzico's refund API; mode "record" records a refund
 * already made in the iyzico merchant panel. `requestKey` makes the call idempotent.
 */
async function refundOrder(db, cfg, orderId, { amountCents, mode, reason, requestKey, actor, ip }) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  if (o.is_test) throw new OrderError(409, "Demo orders have no payment to refund.");
  if (!["paid", "partially_refunded"].includes(o.payment_status)) throw new OrderError(409, `Cannot refund an order whose payment is "${o.payment_status}".`);
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(String(requestKey || ""))) throw new OrderError(400, "Missing refund request key.");
  const existing = db.prepare("SELECT * FROM refunds WHERE request_key=?").get(requestKey);
  if (existing) return { duplicate: true, order: getOrder(db, orderId) };
  const remaining = o.paid_cents - o.refunded_cents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new OrderError(400, "Enter a refund amount.");
  if (amountCents > remaining) throw new OrderError(400, `Refund exceeds the refundable amount (${usd(remaining)}).`);
  if (!["iyzico", "record"].includes(mode)) throw new OrderError(400, "Invalid refund mode.");
  if (refundLocks.has(orderId)) throw new OrderError(409, "A refund for this order is already in progress.");
  refundLocks.add(orderId);
  try {
    let providerRef = null;
    if (mode === "iyzico") {
      if (!iyzico.checkoutStatus(cfg).enabled) throw new OrderError(409, "iyzico is not configured; refund in the iyzico panel and record it here.");
      if (!o.iyzico_payment_id) throw new OrderError(409, "No iyzico payment ID on this order.");
      ({ providerRef } = await iyzico.refund(cfg, o, amountCents, ip));
    }
    db.transaction(() => {
      db.prepare("INSERT INTO refunds(order_id,request_key,amount_cents,method,provider_ref,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(orderId, requestKey, amountCents, mode === "iyzico" ? "iyzico_api" : "recorded_manual", providerRef, str(reason, 300), actor, now());
      const refunded = o.refunded_cents + amountCents;
      const status = refunded >= o.paid_cents ? "refunded" : "partially_refunded";
      db.prepare("UPDATE orders SET refunded_cents=?, payment_status=?, updated_at=? WHERE id=?").run(refunded, status, now(), orderId);
      event(db, orderId, "refund", `${usd(amountCents)} ${mode === "iyzico" ? "refunded via iyzico" : "recorded (refunded in iyzico panel)"}${reason ? ` — ${str(reason, 200)}` : ""}`, actor);
    })();
    return { duplicate: false, order: getOrder(db, orderId) };
  } catch (err) {
    if (err instanceof OrderError) throw err;
    event(db, orderId, "refund_failed", String(err.message || err), actor);
    throw new OrderError(502, String(err.message || err));
  } finally {
    refundLocks.delete(orderId);
  }
}

// ---------------------------------------------------------------- fulfillment

const TRANSITIONS = {
  unfulfilled: ["supplier_order_prepared", "supplier_ordered", "cancelled"],
  supplier_order_prepared: ["supplier_ordered", "unfulfilled", "cancelled"],
  supplier_ordered: ["shipped", "cancelled"],
  shipped: ["delivered", "return_requested"],
  delivered: ["return_requested"],
  return_requested: ["returned", "delivered"],
  returned: [],
  cancelled: [],
};

function assertTransition(o, to) {
  if (o.fulfillment_status === to) return;
  if (!(TRANSITIONS[o.fulfillment_status] || []).includes(to)) {
    throw new OrderError(409, `Cannot change logistics status from "${o.fulfillment_status}" to "${to}".`);
  }
  // Cancelling, delivery confirmation and returns can follow a refund; only moving the
  // goods toward the customer requires a verified payment.
  if (!["supplier_order_prepared", "supplier_ordered", "shipped"].includes(to)) return;
  if (o.is_test) throw new OrderError(409, "Demo orders are unpaid and can never be fulfilled.");
  if (!["paid", "partially_refunded"].includes(o.payment_status)) {
    throw new OrderError(409, "Only orders whose payment was verified with iyzico can be fulfilled.");
  }
}

const optCents = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new OrderError(400, "Invalid amount.");
  return Math.round(n * 100);
};
const optDate = (v) => {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new OrderError(400, "Invalid date.");
  return d.toISOString();
};

function setStatus(db, o, to, details, actor) {
  assertTransition(o, to);
  if (o.fulfillment_status !== to) {
    db.prepare("UPDATE orders SET fulfillment_status=?, updated_at=? WHERE id=?").run(to, now(), o.id);
    event(db, o.id, `status_${to}`, details || `${o.fulfillment_status} → ${to}`, actor);
  }
}

/** Builds the text the owner pastes into the supplier's email/chat. Marks the order prepared. */
function supplierOrderText(db, cfg, orderId, { includePhone }, actor) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  if (o.is_test) throw new OrderError(409, "Demo orders are unpaid and must never be sent to the supplier.");
  if (!["paid", "partially_refunded"].includes(o.payment_status)) throw new OrderError(409, "Only paid orders can be sent to the supplier.");
  const items = getItems(db, orderId);
  const lines = [
    `Order reference: ${o.order_number}`,
    "",
    ...items.flatMap(i => [`Product reference: ${i.supplier_sku || i.sku}`, `Product: ${i.product_name}`, `Colour / variant: ${i.supplier_variant || i.variant_name}`, `Quantity: ${i.quantity}`, ""]),
    "Ship to:",
    o.customer_name,
    o.address1,
    ...(o.address2 ? [o.address2] : []),
    `${o.city}, ${o.state} ${o.postal_code}`,
    "United States",
    ...(includePhone && o.customer_phone ? [`Phone (for the carrier only): ${o.customer_phone}`] : []),
    "",
    `Instructions: ${cfg.supplierInstructions}`,
  ];
  if (o.fulfillment_status === "unfulfilled") setStatus(db, o, "supplier_order_prepared", "Supplier order text copied.", actor);
  return lines.join("\n");
}

/** Records the supplier order the owner placed manually. */
function recordSupplierOrder(db, orderId, b, actor) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  const reference = str(b.supplierReference, 100);
  if (!reference) throw new OrderError(400, "Supplier order reference is required.");
  assertTransition(o, "supplier_ordered");
  const orderedAt = optDate(b.supplierOrderedAt) || now();
  db.transaction(() => {
    db.prepare(`UPDATE orders SET supplier_reference=?, supplier_ordered_at=?, supplier_confirmation=?,
      actual_product_cost_cents=COALESCE(?,actual_product_cost_cents), actual_shipping_cost_cents=COALESCE(?,actual_shipping_cost_cents), updated_at=? WHERE id=?`)
      .run(reference, orderedAt, str(b.supplierConfirmation, 500) || null, optCents(b.actualProductCost), optCents(b.actualShippingCost), now(), orderId);
    setStatus(db, o, "supplier_ordered", `Supplier order ${reference}`, actor);
  })();
  return getOrder(db, orderId);
}

function shipmentEmail(cfg, o) {
  const tracking = o.tracking_url ? `Track your parcel: ${o.tracking_url}` : `Tracking number: ${o.tracking_number}`;
  return {
    subject: `Your ${cfg.storeName} order ${o.order_number} has shipped`,
    body: [
      `Hi ${o.customer_name.split(" ")[0]},`,
      "",
      `Good news — your order ${o.order_number} is on its way.`,
      "",
      `Carrier: ${o.carrier || "see tracking link"}`,
      ...(o.tracking_number ? [`Tracking number: ${o.tracking_number}`] : []),
      tracking,
      "",
      "Tracking can take up to 48 hours to show the first scan.",
      `Questions? Reply to this email${cfg.supportEmail ? ` or write to ${cfg.supportEmail}` : ""}.`,
      "",
      `— ${cfg.storeName}`,
    ].join("\n"),
  };
}

/** Records shipment info, moves to "shipped" and prepares (or sends) the customer email. */
async function recordShipment(db, cfg, orderId, b, actor) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  const carrier = str(b.carrier, 80);
  const trackingNumber = str(b.trackingNumber, 120);
  const trackingUrl = str(b.trackingUrl, 500);
  const justification = str(b.justification, 500);
  if (trackingUrl && !/^https:\/\/[^\s]+$/i.test(trackingUrl)) throw new OrderError(400, "Tracking URL must start with https://");
  if (!trackingNumber && justification.length < 15) {
    throw new OrderError(400, "A tracking number is required. Without one, explain how the shipment was verified (at least 15 characters).");
  }
  assertTransition(o, "shipped");
  db.transaction(() => {
    db.prepare("UPDATE orders SET carrier=?, tracking_number=?, tracking_url=?, shipped_at=?, shipping_justification=?, updated_at=? WHERE id=?")
      .run(carrier || null, trackingNumber || null, trackingUrl || null, optDate(b.shippedAt) || now(), trackingNumber ? null : justification, now(), orderId);
    setStatus(db, o, "shipped", trackingNumber ? `${carrier} ${trackingNumber}` : `No tracking — ${justification}`, actor);
  })();
  const shipped = getOrder(db, orderId);
  const mail = shipmentEmail(cfg, shipped);
  const email = await notify.queueEmail(db, cfg, { orderId, kind: "shipment", to: shipped.customer_email, subject: mail.subject, body: mail.body });
  event(db, orderId, email.status === "sent" ? "email_sent" : "email_prepared",
    email.status === "sent" ? `Shipment email sent to ${shipped.customer_email}` :
    email.status === "failed" ? `Shipment email failed: ${email.error}` : "Shipment email prepared — no email provider configured, send it manually.", actor);
  return { order: shipped, email };
}

/** Generic status change for delivered / cancelled / returns. */
function changeStatus(db, orderId, b, actor) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  const to = String(b.status || "");
  if (!["unfulfilled", "supplier_order_prepared", "delivered", "cancelled", "return_requested", "returned"].includes(to)) {
    throw new OrderError(400, "Use the supplier / shipment forms for that status.");
  }
  const note = str(b.note, 300);
  if (to === "cancelled" && ["paid", "partially_refunded"].includes(o.payment_status) && !note) {
    throw new OrderError(400, "Explain why this paid order is cancelled (and refund it).");
  }
  db.transaction(() => {
    setStatus(db, o, to, note, actor);
    if (to === "delivered") db.prepare("UPDATE orders SET delivered_at=? WHERE id=?").run(optDate(b.deliveredAt) || now(), orderId);
  })();
  return getOrder(db, orderId);
}

function updateCosts(db, orderId, b, actor) {
  const o = getOrder(db, orderId);
  if (!o) throw new OrderError(404, "Order not found.");
  const fields = { actualProductCost: "actual_product_cost_cents", actualShippingCost: "actual_shipping_cost_cents", actualFee: "fee_actual_cents", adSpend: "ad_spend_cents", otherCost: "other_cost_cents" };
  const sets = []; const vals = []; const changes = [];
  for (const [k, col] of Object.entries(fields)) {
    if (b[k] === undefined) continue;
    let v = optCents(b[k]);
    if (v === null && (col === "ad_spend_cents" || col === "other_cost_cents")) v = 0;
    sets.push(`${col}=?`); vals.push(v); changes.push(`${k}=${v === null ? "cleared" : usd(v)}`);
  }
  if (!sets.length) throw new OrderError(400, "Nothing to update.");
  db.prepare(`UPDATE orders SET ${sets.join(",")}, updated_at=? WHERE id=?`).run(...vals, now(), orderId);
  event(db, orderId, "costs_updated", changes.join(", "), actor);
  return getOrder(db, orderId);
}

module.exports = {
  OrderError, US_STATES, validateCheckout, createOrder, getOrder, getItems, orderDetail, event,
  confirmPayment, refundOrder, supplierOrderText, recordSupplierOrder, recordShipment, changeStatus, updateCosts, TRANSITIONS,
};
