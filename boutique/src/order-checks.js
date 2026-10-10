// Supplier preparation checklist, anomalies and order holds.
// These checks record what the owner verified against the order, the supplier's listing and
// the supplier's confirmation. They are NOT a physical inspection of the parcel, and the
// admin never presents them as one.
const productFacts = require("./product-facts");

const now = () => new Date().toISOString();
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);

class CheckError extends Error { constructor(status, message) { super(message); this.status = status; } }

const CHECKS = [
  { key: "sku", label: "Supplier SKU matches the confirmed product reference", stage: "before_supplier" },
  { key: "variant", label: "Color / variant matches the customer's order", stage: "before_supplier" },
  { key: "quantity", label: "Quantity matches the customer's order", stage: "before_supplier" },
  { key: "accessories", label: "Expected accessories (box contents) confirmed with the supplier", stage: "before_supplier" },
  { key: "address", label: "Shipping address verified", stage: "before_supplier" },
  { key: "tracking", label: "Tracking number recorded", stage: "after_shipping", auto: true },
  { key: "customer_informed", label: "Customer informed of the real status", stage: "after_shipping" },
];
const BY_KEY = Object.fromEntries(CHECKS.map(c => [c.key, c]));

const ISSUE_KINDS = {
  supplier_unavailable: "Supplier: product or color unavailable",
  wrong_reference: "Supplier: wrong or changed product reference",
  address_problem: "Address problem",
  wrong_item_reported: "Customer reports wrong item / color",
  damaged_reported: "Customer reports damaged or defective item",
  delivery_problem: "Delivery delayed or lost",
  other: "Other",
};

function event(db, orderId, name, details, actor) {
  db.prepare("INSERT INTO order_events(order_id,event,details,actor,created_at) VALUES(?,?,?,?,?)").run(orderId, name, String(details).slice(0, 1000), actor, now());
}

function stored(db, orderId) {
  return Object.fromEntries(db.prepare("SELECT item,checked,note,actor,updated_at FROM order_checks WHERE order_id=?").all(orderId).map(r => [r.item, r]));
}

/** Supplier SKUs on the order that differ from the SKU confirmed in Product info. */
function skuMismatches(items, confirmedSku) {
  if (!confirmedSku) return [];
  return [...new Set(items.map(i => i.supplier_sku || i.sku))].filter(s => s !== confirmedSku);
}

/** The checklist with what the owner needs to compare, for the order drawer. */
function checklist(db, order, items) {
  const facts = productFacts.get(db);
  const rows = stored(db, order.id);
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const lastMail = db.prepare("SELECT status FROM emails WHERE order_id=? AND kind='shipment' ORDER BY id DESC LIMIT 1").get(order.id);
  const mismatch = skuMismatches(items, facts.sku);
  const hints = {
    sku: `On this order: ${[...new Set(items.map(i => i.supplier_sku || "not set"))].join(", ")} · Confirmed in Product info: ${facts.sku || "not confirmed yet"}`
      + (mismatch.length ? ` · MISMATCH: ${mismatch.join(", ")}` : ""),
    variant: items.map(i => `${i.quantity} × ${i.variant_name}${i.supplier_variant ? ` (supplier: ${i.supplier_variant})` : ""}`).join(", "),
    quantity: `${units} unit(s) in total`,
    accessories: facts.inBox ? `Expected in the box: ${facts.inBox.split("\n").filter(Boolean).join(", ")}` : "Box contents not confirmed in Product info yet",
    address: [order.customer_name, order.address1, order.address2, `${order.city}, ${order.state} ${order.postal_code}`].filter(Boolean).join(", "),
    tracking: order.tracking_number ? `${order.carrier || ""} ${order.tracking_number}`.trim() : order.shipping_justification ? `No tracking — ${order.shipping_justification}` : "Not recorded yet",
    customer_informed: lastMail ? `Shipment email ${lastMail.status}` : "No shipment email yet",
  };
  return CHECKS.map(c => {
    const r = rows[c.key];
    const checked = c.auto ? Boolean(order.tracking_number) : Boolean(r && r.checked);
    return { key: c.key, label: c.label, stage: c.stage, auto: Boolean(c.auto), checked, hint: hints[c.key],
      warning: c.key === "sku" && mismatch.length > 0, note: r ? r.note : null, by: r ? r.actor : null, at: r ? r.updated_at : null };
  });
}

/** Pre-supplier checks still open (the supplier order can't be recorded until this is empty). */
function missingBeforeSupplier(db, orderId) {
  const rows = stored(db, orderId);
  return CHECKS.filter(c => c.stage === "before_supplier" && !(rows[c.key] && rows[c.key].checked)).map(c => c.label);
}

function setCheck(db, order, items, body, actor) {
  const item = String(body.item || "");
  const c = BY_KEY[item];
  if (!c) throw new CheckError(400, "Unknown checklist item.");
  if (c.auto) throw new CheckError(400, "This item is filled automatically from the shipment.");
  if (order.is_test) throw new CheckError(409, "Demo orders are never sent to the supplier.");
  const checked = body.checked === true;
  const note = str(body.note, 300);
  if (checked) {
    const facts = productFacts.get(db);
    if (item === "sku") {
      if (items.some(i => !i.supplier_sku || i.supplier_sku === "CONFIRM-WITH-SUPPLIER")) {
        throw new CheckError(409, "This order has no real supplier SKU (set SUPPLIER_PRODUCT_SKU on the server). Record an anomaly instead.");
      }
      const mismatch = skuMismatches(items, facts.sku);
      if (mismatch.length) throw new CheckError(409, `SKU mismatch: this order uses ${mismatch.join(", ")} but the confirmed SKU is ${facts.sku}. Record an anomaly instead.`);
      if (!facts.sku && note.length < 5) throw new CheckError(400, "No SKU is confirmed in Product info yet: add a note saying how you verified the reference.");
    }
    if (item === "accessories" && !facts.inBox && note.length < 5) throw new CheckError(400, "Box contents aren't confirmed in Product info yet: add a note saying what the supplier confirmed.");
  }
  db.transaction(() => {
    db.prepare(`INSERT INTO order_checks(order_id,item,checked,note,actor,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(order_id,item) DO UPDATE SET checked=excluded.checked, note=excluded.note, actor=excluded.actor, updated_at=excluded.updated_at`)
      .run(order.id, item, checked ? 1 : 0, note || null, actor, now());
    event(db, order.id, checked ? "check_done" : "check_undone", `${c.label}${note ? ` — ${note}` : ""}`, actor);
  })();
}

function issues(db, orderId) {
  return db.prepare("SELECT id,kind,details,holds,actor,created_at,resolved_at,resolved_by,resolution FROM order_issues WHERE order_id=? ORDER BY id DESC").all(orderId)
    .map(i => ({ ...i, holds: Boolean(i.holds), kind_label: ISSUE_KINDS[i.kind] || i.kind }));
}

function syncHold(db, orderId) {
  const open = db.prepare("SELECT COUNT(*) n FROM order_issues WHERE order_id=? AND holds=1 AND resolved_at IS NULL").get(orderId).n;
  db.prepare("UPDATE orders SET on_hold=?, updated_at=? WHERE id=?").run(open > 0 ? 1 : 0, now(), orderId);
}

function openIssue(db, order, body, actor) {
  const kind = String(body.kind || "");
  if (!ISSUE_KINDS[kind]) throw new CheckError(400, "Choose the type of anomaly.");
  const details = str(body.details, 1000);
  if (details.length < 10) throw new CheckError(400, "Describe the anomaly (at least 10 characters), e.g. what the supplier confirmed.");
  const holds = body.hold === true;
  let id;
  db.transaction(() => {
    id = db.prepare("INSERT INTO order_issues(order_id,kind,details,holds,actor,created_at) VALUES(?,?,?,?,?,?)").run(order.id, kind, details, holds ? 1 : 0, actor, now()).lastInsertRowid;
    event(db, order.id, holds ? "issue_opened_hold" : "issue_opened", `${ISSUE_KINDS[kind]}: ${details}`, actor);
    syncHold(db, order.id);
  })();
  return id;
}

function resolveIssue(db, order, issueId, body, actor) {
  const issue = db.prepare("SELECT * FROM order_issues WHERE id=? AND order_id=?").get(issueId, order.id);
  if (!issue) throw new CheckError(404, "Anomaly not found.");
  if (issue.resolved_at) throw new CheckError(409, "This anomaly is already resolved.");
  const resolution = str(body.resolution, 500);
  if (resolution.length < 5) throw new CheckError(400, "Explain how it was resolved.");
  db.transaction(() => {
    db.prepare("UPDATE order_issues SET resolved_at=?, resolved_by=?, resolution=? WHERE id=?").run(now(), actor, resolution, issueId);
    event(db, order.id, "issue_resolved", `${ISSUE_KINDS[issue.kind] || issue.kind}: ${resolution}`, actor);
    syncHold(db, order.id);
  })();
}

module.exports = { CHECKS, ISSUE_KINDS, CheckError, checklist, missingBeforeSupplier, setCheck, issues, openIssue, resolveIssue };
