// Profitability. Pure functions on integer cents.
//
// profit = retained revenue - product cost - shipping cost - payment fees - ad spend - other costs
// margin = profit / retained revenue × 100
//
// - Retained revenue = amount actually paid - refunds (0 for unpaid/test orders).
// - Each cost uses the ACTUAL value when recorded, otherwise the ESTIMATE; the basis is
//   reported so estimates are never presented as real costs.
// - Shipping charged to the customer is already inside the paid amount; the supplier's
//   shipping cost is counted once, as a cost. Refunds only reduce revenue.
// - An order cancelled before the supplier was paid carries no product/shipping cost.

const PAID_STATES = new Set(["paid", "partially_refunded", "refunded"]);

function referenceUnitCostCents(settings) {
  return toCents(settings.product_cost_usd) + toCents(settings.shipping_cost_usd);
}

function toCents(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function estimateFeeCents(totalCents, settings) {
  const pct = Number(settings.payment_fee_percent) || 0;
  return Math.round(totalCents * pct / 100) + toCents(settings.payment_fee_fixed_usd);
}

function orderProfit(o) {
  const paid = !o.is_test && PAID_STATES.has(o.payment_status);
  const revenue = paid ? Math.max(0, o.paid_cents - o.refunded_cents) : 0;
  const neverSupplied = o.fulfillment_status === "cancelled" && !o.supplier_ordered_at;
  const pick = (actual, est) => actual === null || actual === undefined
    ? { cents: est, basis: "estimated" } : { cents: actual, basis: "actual" };

  const product = paid && !neverSupplied ? pick(o.actual_product_cost_cents, o.est_product_cost_cents) : { cents: 0, basis: "none" };
  const shipping = paid && !neverSupplied ? pick(o.actual_shipping_cost_cents, o.est_shipping_cost_cents) : { cents: 0, basis: "none" };
  const fee = paid ? pick(o.fee_actual_cents, o.fee_estimated_cents) : { cents: 0, basis: "none" };
  const ads = paid ? o.ad_spend_cents || 0 : 0;
  const other = paid ? o.other_cost_cents || 0 : 0;

  const costs = product.cents + shipping.cents + fee.cents + ads + other;
  const profit = revenue - costs;
  return {
    counted: paid,
    revenue_cents: revenue,
    product_cost: product, shipping_cost: shipping, payment_fee: fee,
    ad_spend_cents: ads, other_cost_cents: other,
    total_cost_cents: costs,
    profit_cents: profit,
    margin_percent: revenue > 0 ? Math.round(profit / revenue * 10000) / 100 : null,
  };
}

function dashboard(orders) {
  const t = { paid_orders: 0, pending_orders: 0, failed_orders: 0, test_orders: 0, gross_paid_cents: 0, refunds_cents: 0, discounts_cents: 0,
    revenue_cents: 0, product_cost_cents: 0, shipping_cost_cents: 0, fees_cents: 0, ads_cents: 0, other_cents: 0,
    total_cost_cents: 0, profit_cents: 0, estimated_components: 0, to_fulfil: 0 };
  for (const o of orders) {
    if (o.is_test) { t.test_orders++; continue; }
    if (o.payment_status === "pending") { t.pending_orders++; continue; }
    if (o.payment_status === "failed") { t.failed_orders++; continue; }
    const p = orderProfit(o);
    t.paid_orders++;
    t.gross_paid_cents += o.paid_cents;
    t.refunds_cents += o.refunded_cents;
    t.discounts_cents += o.discount_cents || 0;
    t.revenue_cents += p.revenue_cents;
    t.product_cost_cents += p.product_cost.cents;
    t.shipping_cost_cents += p.shipping_cost.cents;
    t.fees_cents += p.payment_fee.cents;
    t.ads_cents += p.ad_spend_cents;
    t.other_cents += p.other_cost_cents;
    t.total_cost_cents += p.total_cost_cents;
    t.profit_cents += p.profit_cents;
    t.estimated_components += [p.product_cost, p.shipping_cost, p.payment_fee].filter(c => c.basis === "estimated").length;
    if (["unfulfilled", "supplier_order_prepared", "supplier_ordered"].includes(o.fulfillment_status) && o.payment_status !== "refunded") t.to_fulfil++;
  }
  t.margin_percent = t.revenue_cents > 0 ? Math.round(t.profit_cents / t.revenue_cents * 10000) / 100 : null;
  return t;
}

/**
 * Per-order margin simulation ("what if"): price actually charged after discount, minus
 * supplier product + shipping, payment fees, ad cost per order and other costs.
 * Returns cents; break-even ad cost = the most you can spend to acquire one order.
 */
function unitEconomics({ priceCents, units = 1, discountCents = 0, shippingChargedCents = 0, settings, adPerOrderCents = 0, otherCents = 0 }) {
  const u = Math.max(1, Math.min(100, Math.round(units)));
  const subtotal = priceCents * u;
  const discount = Math.max(0, Math.min(discountCents, subtotal));
  const charged = subtotal - discount + shippingChargedCents;
  const product = toCents(settings.product_cost_usd) * u;
  const shipping = toCents(settings.shipping_cost_usd) * u;
  const fees = estimateFeeCents(charged, settings);
  const beforeAds = charged - product - shipping - fees - otherCents;
  const profit = beforeAds - adPerOrderCents;
  return {
    charged_cents: charged, discount_cents: discount, product_cost_cents: product, shipping_cost_cents: shipping,
    payment_fee_cents: fees, other_cents: otherCents, ad_cents: adPerOrderCents,
    profit_before_ads_cents: beforeAds, profit_cents: profit,
    margin_percent: charged > 0 ? Math.round(profit / charged * 10000) / 100 : null,
    break_even_ad_cents: Math.max(0, beforeAds),
    fee_configured: Number(settings.payment_fee_percent) > 0 || Number(settings.payment_fee_fixed_usd) > 0,
  };
}

module.exports = { unitEconomics, orderProfit, dashboard, referenceUnitCostCents, estimateFeeCents, toCents, PAID_STATES };
