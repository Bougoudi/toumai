// Supplier preparation checklist, anomalies and holds.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startStore, paidOrder, placeOrder, completeChecklist } = require("./helpers");

test("checklist: admin-only, validated, and required before the supplier order", async () => {
  const s = await startStore();
  try {
    const o = await paidOrder(s);
    for (const p of [`/api/admin/orders/${o.id}/checks`, `/api/admin/orders/${o.id}/issues`, `/api/admin/orders/${o.id}/issues/1/resolve`]) {
      assert.equal((await s.req("POST", p, {})).status, 401, p);
    }
    const h = await s.login();
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "variant", checked: true }, { Cookie: h.Cookie })).status, 403, "CSRF");
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "nope", checked: true }, h)).status, 400);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "tracking", checked: true }, h)).status, 400, "tracking is automatic");
    assert.equal((await s.req("POST", `/api/admin/orders/999/checks`, { item: "variant", checked: true }, h)).status, 404);

    // No SKU confirmed yet: a note explaining the verification is required
    const noNote = await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "sku", checked: true }, h);
    assert.equal(noNote.status, 400); assert.match(noNote.json.error, /No SKU is confirmed/);
    // A confirmed SKU that differs from the order's reference blocks the check
    await s.req("POST", "/api/admin/product-facts", { sku: "CJ-999" }, h);
    const mismatch = await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "sku", checked: true }, h);
    assert.equal(mismatch.status, 409); assert.match(mismatch.json.error, /SKU mismatch: this order uses CJ-123/);
    const detail = (await s.req("GET", `/api/admin/orders/${o.id}`, undefined, h)).json;
    assert.equal(detail.checklist.find(c => c.key === "sku").warning, true);
    await s.req("POST", "/api/admin/product-facts", { sku: "CJ-123" }, h);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "sku", checked: true }, h)).status, 200);

    // Partial checklist: supplier order refused and the missing items are named
    const partial = await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "AE-1" }, h);
    assert.equal(partial.status, 409); assert.match(partial.json.error, /Color \/ variant matches/);
    await completeChecklist(s, h, o.id);
    // Unticking is possible and recorded
    await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "address", checked: false }, h);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "AE-1" }, h)).status, 409);
    await s.req("POST", `/api/admin/orders/${o.id}/checks`, { item: "address", checked: true }, h);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "AE-1" }, h)).status, 200);

    // Tracking is ticked automatically from the shipment; customer_informed stays a human check
    await s.req("POST", `/api/admin/orders/${o.id}/shipment`, { carrier: "USPS", trackingNumber: "9400111" }, h);
    const after = (await s.req("GET", `/api/admin/orders/${o.id}`, undefined, h)).json.checklist;
    assert.equal(after.find(c => c.key === "tracking").checked, true);
    assert.equal(after.find(c => c.key === "customer_informed").checked, false);
    assert.match(after.find(c => c.key === "customer_informed").hint, /Shipment email prepared/);
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND event='check_undone'").get(o.id).n === 1);
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='order_check'").get().n >= 7);

    // An order without a real supplier SKU can't pass the SKU check
    const { o: noSku } = await placeOrder(s);
    s.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(noSku.id);
    s.db.prepare("UPDATE order_items SET supplier_sku='CONFIRM-WITH-SUPPLIER' WHERE order_id=?").run(noSku.id);
    const placeholder = await s.req("POST", `/api/admin/orders/${noSku.id}/checks`, { item: "sku", checked: true, note: "looked at it" }, h);
    assert.equal(placeholder.status, 409); assert.match(placeholder.json.error, /no real supplier SKU/);

    // Demo orders never get a supplier checklist
    const { o: demo } = await placeOrder(s);
    s.db.prepare("UPDATE orders SET is_test=1 WHERE id=?").run(demo.id);
    assert.equal((await s.req("POST", `/api/admin/orders/${demo.id}/checks`, { item: "variant", checked: true }, h)).status, 409);
  } finally { s.close(); }
});

test("anomalies: a hold suspends supplier and shipment steps until resolved", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    const o = await paidOrder(s);
    await completeChecklist(s, h, o.id);
    for (const [body, msg] of [[{ kind: "x", details: "Supplier says out of stock" }, /type of anomaly/], [{ kind: "supplier_unavailable", details: "short" }, /at least 10/]]) {
      const r = await s.req("POST", `/api/admin/orders/${o.id}/issues`, body, h);
      assert.equal(r.status, 400); assert.match(r.json.error, msg);
    }
    const open = await s.req("POST", `/api/admin/orders/${o.id}/issues`, { kind: "supplier_unavailable", details: "Supplier confirms Pearl White is out of stock until Nov 3", hold: true }, h);
    assert.equal(open.status, 201); assert.equal(open.json.on_hold, true);
    assert.equal((await s.req("GET", "/api/admin/dashboard", undefined, h)).json.ordersOnHold, 1);
    const list = (await s.req("GET", "/api/admin/orders", undefined, h)).json;
    assert.equal(list.find(r => r.id === o.id).on_hold, true);

    for (const [p, body] of [["supplier-text", {}], ["supplier-order", { supplierReference: "AE-9" }], ["shipment", { carrier: "USPS", trackingNumber: "1" }]]) {
      const r = await s.req("POST", `/api/admin/orders/${o.id}/${p}`, body, h);
      assert.equal(r.status, 409, p); assert.match(r.json.error, /on hold/);
    }
    // Refunds and cancellation stay possible while on hold
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/status`, { status: "unfulfilled" }, h)).status, 200);

    // A second, non-holding anomaly is only recorded
    await s.req("POST", `/api/admin/orders/${o.id}/issues`, { kind: "other", details: "Customer asked to change the color", hold: false }, h);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/issues/${open.json.id}/resolve`, { resolution: "" }, h)).status, 400);
    const res = await s.req("POST", `/api/admin/orders/${o.id}/issues/${open.json.id}/resolve`, { resolution: "Customer agreed to Camel Brown; supplier confirmed stock" }, h);
    assert.equal(res.status, 200); assert.equal(res.json.on_hold, false);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/issues/${open.json.id}/resolve`, { resolution: "again please" }, h)).status, 409);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/issues/9999/resolve`, { resolution: "nothing here" }, h)).status, 404);
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: "AE-9" }, h)).status, 200);

    const d = (await s.req("GET", `/api/admin/orders/${o.id}`, undefined, h)).json;
    assert.equal(d.issues.length, 2);
    assert.equal(d.issues.find(i => i.id === open.json.id).resolved_by, "owner");
    assert.ok(d.events.some(e => e.event === "issue_opened_hold") && d.events.some(e => e.event === "issue_resolved"));
  } finally { s.close(); }
});
