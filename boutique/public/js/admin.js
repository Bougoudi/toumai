// HavenLume order desk. All rules are enforced server-side; this UI only calls the API.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => c === null || c === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
  const dollars = (c) => c === null || c === undefined ? "" : (c / 100).toFixed(2);
  const date = (s) => s ? new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const dayInput = (s) => s ? new Date(s).toISOString().slice(0, 10) : "";
  const pill = (s) => `<span class="pill pill-${esc(s)}">${esc(String(s).replace(/_/g, " "))}</span>`;
  let csrf = "";

  function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4500); }

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, ...(opts.headers || {}) } });
    if (r.status === 401) { location.href = "/admin-login.html"; throw new Error("Signed out"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });

  // ------------------------------------------------------------ tabs
  const loaders = { dashboard: loadDashboard, orders: loadOrders, messages: loadMessages, settings: loadSettings, activity: loadActivity };
  document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== name; });
    loaders[name]().catch(e => toast(e.message));
  }

  // ------------------------------------------------------------ dashboard
  async function loadDashboard() {
    const d = await api("/api/admin/dashboard");
    const t = d.totals;
    $("#notifBadge").hidden = !d.unreadNotifications; $("#notifBadge").textContent = d.unreadNotifications;
    $("#msgBadge").hidden = !d.openMessages; $("#msgBadge").textContent = d.openMessages;
    const mode = d.checkout.enabled ? (d.checkout.mode === "live" ? "LIVE payments (iyzico)" : "iyzico SANDBOX (test cards)") : `Demo only — ${d.checkout.reason}`;
    $("#statusBar").innerHTML = `<div class="admin-card status-line"><span><b>Payments:</b> ${esc(mode)}</span><span><b>Emails:</b> ${d.emailConfigured ? "sent via Resend" : "not configured — emails are prepared for you to send manually"}</span></div>`;
    const tile = (label, value, sub = "") => `<div class="tile"><p class="micro">${label}</p><p class="tile-value">${value}</p>${sub ? `<p class="micro">${sub}</p>` : ""}</div>`;
    $("#dashboard").innerHTML = `
      <div class="tiles">
        ${tile("Paid orders", t.paid_orders, `${t.to_fulfil} to fulfil · ${t.pending_orders} awaiting payment`)}
        ${tile("Revenue retained", money(t.revenue_cents), `${money(t.gross_paid_cents)} paid − ${money(t.refunds_cents)} refunded`)}
        ${tile("Total costs", money(t.total_cost_cents), t.estimated_components ? `${t.estimated_components} cost item(s) still estimated` : "all actual")}
        ${tile("Estimated profit", money(t.profit_cents), t.margin_percent === null ? "—" : `margin ${t.margin_percent}%`)}
      </div>
      <div class="admin-card">
        <h2 class="admin-h2">Cost breakdown (paid orders)</h2>
        <table class="admin-table compact"><tbody>
          <tr><td>Product (supplier)</td><td>${money(t.product_cost_cents)}</td></tr>
          <tr><td>Shipping (supplier → customer)</td><td>${money(t.shipping_cost_cents)}</td></tr>
          <tr><td>Payment fees</td><td>${money(t.fees_cents)}</td></tr>
          <tr><td>Advertising attributed</td><td>${money(t.ads_cents)}</td></tr>
          <tr><td>Other expenses</td><td>${money(t.other_cents)}</td></tr>
          <tr><td>Refunds (reduce revenue)</td><td>${money(t.refunds_cents)}</td></tr>
        </tbody></table>
        <p class="micro">Reference logistics cost per unit: <b>${money(d.referenceUnitCostCents)}</b> (product ${money(Math.round(d.settings.product_cost_usd * 100))} + shipping ${money(Math.round(d.settings.shipping_cost_usd * 100))}). Actual costs replace estimates once you record them on an order. Failed, pending and demo orders are excluded.</p>
      </div>`;
  }

  // ------------------------------------------------------------ orders
  let qTimer;
  ["#q", "#fPayment", "#fFulfillment", "#fTests"].forEach(s => $(s).addEventListener(s === "#q" ? "input" : "change", () => { clearTimeout(qTimer); qTimer = setTimeout(() => loadOrders().catch(e => toast(e.message)), 250); }));
  async function loadOrders() {
    const p = new URLSearchParams();
    if ($("#q").value) p.set("q", $("#q").value);
    if ($("#fPayment").value) p.set("payment", $("#fPayment").value);
    if ($("#fFulfillment").value) p.set("fulfillment", $("#fFulfillment").value);
    if ($("#fTests").checked) p.set("tests", "1");
    const rows = await api(`/api/admin/orders?${p}`);
    if (!rows.length) { $("#orders").innerHTML = `<div class="admin-card muted">No orders match. Paid orders appear here automatically once iyzico confirms the payment.</div>`; return; }
    $("#orders").innerHTML = `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Logistics</th><th>Profit</th></tr></thead><tbody>
      ${rows.map(o => `<tr class="clickable" data-id="${o.id}" tabindex="0"><td><b>${esc(o.order_number)}</b>${o.is_test ? ' <span class="pill pill-test">demo</span>' : ""}</td><td>${date(o.created_at)}</td>
      <td>${esc(o.customer_name)}<br><span class="muted">${esc(o.customer_email)}</span></td><td>${esc(o.items)}</td><td>${money(o.total_cents)}</td>
      <td>${pill(o.payment_status)}</td><td>${pill(o.fulfillment_status)}${o.tracking_number ? `<br><span class="muted">${esc(o.tracking_number)}</span>` : ""}</td>
      <td>${o.profit.counted ? money(o.profit.profit_cents) : "—"}</td></tr>`).join("")}
    </tbody></table></div>`;
    document.querySelectorAll("tr[data-id]").forEach(tr => {
      const open = () => openOrder(Number(tr.dataset.id));
      tr.addEventListener("click", open); tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    });
  }

  // ------------------------------------------------------------ order detail
  const drawer = $("#drawer");
  drawer.addEventListener("click", e => { if (e.target.hasAttribute("data-close")) closeDrawer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });
  function closeDrawer() { drawer.hidden = true; document.body.classList.remove("no-scroll"); }

  async function openOrder(id) {
    const o = await api(`/api/admin/orders/${id}`);
    const paid = ["paid", "partially_refunded"].includes(o.payment_status) && !o.is_test;
    const f = o.fulfillment_status;
    const p = o.profit;
    const basis = (c) => c.basis === "actual" ? "actual" : c.basis === "estimated" ? "<i>estimate</i>" : "—";
    const shipmentEmail = o.emails.find(e => e.kind === "shipment");
    $("#detail").innerHTML = `
      <p class="eyebrow">${o.is_test ? "DEMO ORDER — NO PAYMENT, NEVER SHIP" : "ORDER"}</p>
      <h2 class="admin-h1">${esc(o.order_number)}</h2>
      <p>${pill(o.payment_status)} ${pill(f)} <span class="muted">· ${date(o.created_at)}</span></p>

      <div class="grid2">
        <div class="admin-card"><h3>Customer &amp; shipping</h3>
          <p><b>${esc(o.customer_name)}</b><br>${esc(o.address1)}${o.address2 ? `<br>${esc(o.address2)}` : ""}<br>${esc(o.city)}, ${esc(o.state)} ${esc(o.postal_code)}<br>United States</p>
          <p>${esc(o.customer_email)}<br>${o.customer_phone ? esc(o.customer_phone) : '<span class="muted">No phone</span>'}</p></div>
        <div class="admin-card"><h3>Items</h3>
          ${o.items.map(i => `<p>${i.quantity} × ${esc(i.product_name)} — <b>${esc(i.variant_name)}</b><br><span class="muted">Supplier ref ${esc(i.supplier_sku)} · ${money(i.unit_price_cents)} each</span></p>`).join("")}
          <p>Subtotal ${money(o.subtotal_cents)} · Shipping ${money(o.shipping_cents)}<br><b>Total ${money(o.total_cents)}</b> · Paid ${money(o.paid_cents)}${o.refunded_cents ? ` · Refunded ${money(o.refunded_cents)}` : ""}</p></div>
      </div>

      <div class="admin-card"><h3>Payment</h3>
        <p>Provider: ${esc(o.payment_provider || "none (demo)")}${o.iyzico_payment_id ? ` · iyzico payment <b>${esc(o.iyzico_payment_id)}</b>` : ""}${o.paid_at ? ` · paid ${date(o.paid_at)}` : ""}</p>
        ${o.iyzico_token && !["paid", "partially_refunded", "refunded"].includes(o.payment_status) ? `<button class="admin-btn" id="verify">Re-check payment with iyzico</button>` : ""}
        ${paid ? `<form id="refundForm" class="admin-form inline-form">
          <label>Refund amount (USD)<input name="amount" type="number" step="0.01" min="0.01" max="${dollars(o.paid_cents - o.refunded_cents)}" value="${dollars(o.paid_cents - o.refunded_cents)}" required></label>
          <label>Method<select name="mode"><option value="iyzico">Refund through iyzico now</option><option value="record">Record a refund already made in the iyzico panel</option></select></label>
          <label>Reason<input name="reason" maxlength="300" placeholder="e.g. damaged on arrival"></label>
          <button class="admin-btn danger-btn">Refund</button></form>` : ""}
        ${o.refunds.length ? `<p class="micro">${o.refunds.map(r => `${date(r.created_at)} — ${money(r.amount_cents)} (${esc(r.method)}) ${esc(r.reason || "")}`).join("<br>")}</p>` : ""}
      </div>

      <div class="admin-card"><h3>1 · Supplier order</h3>
        ${paid ? `<label class="check"><input type="checkbox" id="includePhone"> Include phone (only if the carrier requires it)</label>
          <button class="admin-btn" id="copySupplier">Copy Supplier Order</button>
          <pre class="supplier-text" id="supplierText" hidden></pre>` : `<p class="muted">Available once the payment is verified.</p>`}
        <form id="supplierForm" class="admin-form grid-form">
          <label>Supplier order date<input name="supplierOrderedAt" type="date" value="${dayInput(o.supplier_ordered_at)}"></label>
          <label>Supplier order reference<input name="supplierReference" value="${esc(o.supplier_reference || "")}" maxlength="100" required></label>
          <label>Actual product cost (USD)<input name="actualProductCost" type="number" step="0.01" min="0" value="${dollars(o.actual_product_cost_cents)}" placeholder="est. ${dollars(o.est_product_cost_cents)}"></label>
          <label>Actual shipping cost (USD)<input name="actualShippingCost" type="number" step="0.01" min="0" value="${dollars(o.actual_shipping_cost_cents)}" placeholder="est. ${dollars(o.est_shipping_cost_cents)}"></label>
          <label class="span2">Supplier confirmation<input name="supplierConfirmation" value="${esc(o.supplier_confirmation || "")}" maxlength="500" placeholder="e.g. confirmed by email, dispatch in 2 days"></label>
          <button class="admin-btn span2" ${paid && ["unfulfilled", "supplier_order_prepared", "supplier_ordered"].includes(f) ? "" : "disabled"}>Save supplier order</button>
        </form>
      </div>

      <div class="admin-card"><h3>2 · Shipment</h3>
        <form id="shipForm" class="admin-form grid-form">
          <label>Carrier<input name="carrier" value="${esc(o.carrier || "")}" maxlength="80" placeholder="USPS, UPS, YunExpress…"></label>
          <label>Tracking number<input name="trackingNumber" value="${esc(o.tracking_number || "")}" maxlength="120"></label>
          <label class="span2">Tracking link (https)<input name="trackingUrl" value="${esc(o.tracking_url || "")}" maxlength="500" placeholder="https://"></label>
          <label>Ship date<input name="shippedAt" type="date" value="${dayInput(o.shipped_at)}"></label>
          <label>No tracking? Verified justification<input name="justification" maxlength="500" value="${esc(o.shipping_justification || "")}" placeholder="How was dispatch verified?"></label>
          <button class="admin-btn span2" ${paid && f === "supplier_ordered" ? "" : "disabled"}>Mark as shipped &amp; prepare customer email</button>
        </form>
        ${shipmentEmail ? emailBlock(shipmentEmail) : ""}
      </div>

      <div class="admin-card"><h3>3 · Delivery, cancellation &amp; returns</h3>
        <form id="statusForm" class="admin-form inline-form">
          <label>New status<select name="status">
            ${["delivered", "return_requested", "returned", "cancelled", "unfulfilled"].map(s => `<option value="${s}">${s.replace(/_/g, " ")}</option>`).join("")}
          </select></label>
          <label>Date (delivered)<input name="deliveredAt" type="date"></label>
          <label>Note<input name="note" maxlength="300" placeholder="Required to cancel a paid order"></label>
          <button class="admin-btn">Update status</button>
        </form>
        ${o.delivered_at ? `<p class="micro">Delivered ${date(o.delivered_at)}</p>` : ""}
      </div>

      <div class="admin-card"><h3>Profitability</h3>
        <table class="admin-table compact"><tbody>
          <tr><td>Revenue retained (paid − refunds)</td><td>${money(p.revenue_cents)}</td><td></td></tr>
          <tr><td>Product cost</td><td>− ${money(p.product_cost.cents)}</td><td>${basis(p.product_cost)}</td></tr>
          <tr><td>Shipping cost</td><td>− ${money(p.shipping_cost.cents)}</td><td>${basis(p.shipping_cost)}</td></tr>
          <tr><td>Payment fees</td><td>− ${money(p.payment_fee.cents)}</td><td>${basis(p.payment_fee)}</td></tr>
          <tr><td>Advertising attributed</td><td>− ${money(p.ad_spend_cents)}</td><td></td></tr>
          <tr><td>Other expenses</td><td>− ${money(p.other_cost_cents)}</td><td></td></tr>
          <tr class="total-row"><td>Estimated profit</td><td>${money(p.profit_cents)}</td><td>${p.margin_percent === null ? "" : `margin ${p.margin_percent}%`}</td></tr>
        </tbody></table>
        <form id="costForm" class="admin-form grid-form">
          <label>Actual payment fee (USD)<input name="actualFee" type="number" step="0.01" min="0" value="${dollars(o.fee_actual_cents)}" placeholder="est. ${dollars(o.fee_estimated_cents)}"></label>
          <label>Ad spend attributed (USD)<input name="adSpend" type="number" step="0.01" min="0" value="${dollars(o.ad_spend_cents)}"></label>
          <label>Other expenses (USD)<input name="otherCost" type="number" step="0.01" min="0" value="${dollars(o.other_cost_cents)}"></label>
          <button class="admin-btn">Save costs</button>
        </form>
      </div>

      <div class="admin-card"><h3>Internal notes</h3><textarea id="notes" rows="3" maxlength="4000">${esc(o.notes || "")}</textarea><button class="admin-btn" id="saveNotes">Save notes</button></div>
      <div class="admin-card"><h3>History</h3>${o.events.map(e => `<p class="micro">${date(e.created_at)} · <b>${esc(e.event)}</b> ${esc(e.details || "")} <span class="muted">(${esc(e.actor)})</span></p>`).join("")}</div>`;

    drawer.hidden = false; document.body.classList.add("no-scroll");
    const reload = async (msg) => { toast(msg); await openOrder(id); loadOrders().catch(() => {}); loadDashboard().catch(() => {}); };
    const form = (sel, fn) => { const fm = $(sel); if (fm) fm.addEventListener("submit", async e => { e.preventDefault(); try { await fn(Object.fromEntries(new FormData(fm))); } catch (err) { toast(err.message); } }); };

    $("#verify")?.addEventListener("click", async () => { try { await post(`/api/admin/orders/${id}/verify-payment`); reload("Payment verified with iyzico."); } catch (e) { toast(e.message); } });
    $("#copySupplier")?.addEventListener("click", async () => {
      try {
        const { text } = await post(`/api/admin/orders/${id}/supplier-text`, { includePhone: $("#includePhone").checked });
        const pre = $("#supplierText"); pre.textContent = text; pre.hidden = false;
        try { await navigator.clipboard.writeText(text); toast("Supplier order copied. Paste it into your email or the supplier's chat."); }
        catch { toast("Copy blocked by the browser — select the text below and copy it."); }
      } catch (e) { toast(e.message); }
    });
    form("#refundForm", async (d) => {
      if (!confirm(`Refund $${d.amount} on ${o.order_number}${d.mode === "iyzico" ? " through iyzico now" : " (record only)"}?`)) return;
      await post(`/api/admin/orders/${id}/refund`, { ...d, requestKey: crypto.randomUUID() }); reload("Refund recorded.");
    });
    form("#supplierForm", async (d) => { await post(`/api/admin/orders/${id}/supplier-order`, d); reload("Supplier order saved."); });
    form("#shipForm", async (d) => {
      const r = await post(`/api/admin/orders/${id}/shipment`, d);
      await reload(r.email.status === "sent" ? "Shipped — email sent to the customer." : r.email.status === "failed" ? "Shipped — the email FAILED, see below." : "Shipped — customer email prepared (not sent: no email provider).");
    });
    form("#statusForm", async (d) => { await post(`/api/admin/orders/${id}/status`, d); reload("Status updated."); });
    form("#costForm", async (d) => { await post(`/api/admin/orders/${id}/costs`, d); reload("Costs saved."); });
    $("#saveNotes").addEventListener("click", async () => { try { await post(`/api/admin/orders/${id}/notes`, { notes: $("#notes").value }); toast("Notes saved."); } catch (e) { toast(e.message); } });
    document.querySelectorAll("[data-email-copy]").forEach(b => b.addEventListener("click", async () => {
      const e = o.emails.find(x => x.id === Number(b.dataset.emailCopy));
      try { await navigator.clipboard.writeText(`To: ${e.to_addr}\nSubject: ${e.subject}\n\n${e.body}`); toast("Email copied."); } catch { toast("Select the text and copy it."); }
    }));
    document.querySelectorAll("[data-email-send]").forEach(b => b.addEventListener("click", async () => {
      try { await post(`/api/admin/emails/${b.dataset.emailSend}/send`); reload("Email sent."); } catch (e) { toast(e.message); }
    }));
    document.querySelectorAll("[data-email-manual]").forEach(b => b.addEventListener("click", async () => {
      try { await post(`/api/admin/emails/${b.dataset.emailManual}/mark-sent`); reload("Marked as sent manually."); } catch (e) { toast(e.message); }
    }));
  }

  function emailBlock(e) {
    const status = e.status === "sent" ? `<span class="pill pill-paid">sent ${date(e.sent_at)}</span>` : e.status === "failed" ? `<span class="pill pill-failed">failed: ${esc(e.error)}</span>` : `<span class="pill pill-pending">prepared — NOT sent</span>`;
    return `<div class="email-draft"><p><b>Customer email</b> ${status}</p><p class="micro">To: ${esc(e.to_addr)}<br>Subject: ${esc(e.subject)}</p><pre>${esc(e.body)}</pre>
      ${e.status !== "sent" ? `<button class="admin-btn ghost" data-email-copy="${e.id}">Copy email</button><button class="admin-btn ghost" data-email-send="${e.id}">Send via email provider</button><button class="admin-btn ghost" data-email-manual="${e.id}">I sent it myself</button>` : ""}</div>`;
  }

  // ------------------------------------------------------------ other tabs
  async function loadMessages() {
    const rows = await api("/api/admin/messages");
    $("#messages").innerHTML = rows.length ? rows.map(m => `<div class="admin-card ${m.handled_at ? "muted" : ""}"><p><b>${esc(m.name)}</b> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.order_number ? ` · order ${esc(m.order_number)}` : ""} <span class="muted">${date(m.created_at)}</span></p><p class="pre">${esc(m.message)}</p>${m.handled_at ? `<p class="micro">Handled ${date(m.handled_at)}</p>` : `<button class="admin-btn" data-handled="${m.id}">Mark handled</button>`}</div>`).join("") : `<div class="admin-card muted">No messages yet.</div>`;
    document.querySelectorAll("[data-handled]").forEach(b => b.addEventListener("click", async () => { await post(`/api/admin/messages/${b.dataset.handled}/handled`); loadMessages(); loadDashboard(); }));
  }

  async function loadSettings() {
    const s = await api("/api/admin/settings");
    $("#settings").innerHTML = `<div class="admin-card"><h2 class="admin-h2">Cost estimates</h2>
      <p class="micro">Used for new orders' estimated costs. Existing orders keep the estimate captured when they were placed; record actual costs on each order.</p>
      <form id="settingsForm" class="admin-form grid-form">
        <label>Supplier product cost per unit (USD)<input name="product_cost_usd" type="number" step="0.01" min="0" value="${esc(s.product_cost_usd)}"></label>
        <label>Supplier shipping per unit (USD)<input name="shipping_cost_usd" type="number" step="0.01" min="0" value="${esc(s.shipping_cost_usd)}"></label>
        <label>Payment fee estimate (% of total)<input name="payment_fee_percent" type="number" step="0.01" min="0" max="20" value="${esc(s.payment_fee_percent)}"></label>
        <label>Payment fee estimate (fixed USD per order)<input name="payment_fee_fixed_usd" type="number" step="0.01" min="0" value="${esc(s.payment_fee_fixed_usd)}"></label>
        <button class="admin-btn span2">Save</button></form>
      <p id="refCost" class="micro"></p></div>
      <div class="admin-card"><h2 class="admin-h2">Backup</h2><p class="micro">Download a consistent copy of the database. Automatic backups are also written daily on the server's disk.</p><a class="admin-btn" href="/api/admin/backup">Download backup</a></div>`;
    const ref = () => { const f = new FormData($("#settingsForm")); $("#refCost").textContent = `Reference logistics cost: $${(Number(f.get("product_cost_usd")) + Number(f.get("shipping_cost_usd"))).toFixed(2)} per unit.`; };
    ref(); $("#settingsForm").addEventListener("input", ref);
    $("#settingsForm").addEventListener("submit", async e => { e.preventDefault(); try { await post("/api/admin/settings", Object.fromEntries(new FormData(e.target))); toast("Settings saved."); loadDashboard(); } catch (err) { toast(err.message); } });
  }

  async function loadActivity() {
    const rows = await api("/api/admin/audit");
    $("#activity").innerHTML = `<div class="table-scroll"><table class="admin-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead><tbody>${rows.map(a => `<tr><td>${date(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.target || "")}</td><td class="wrap">${esc(a.details || "")}</td><td>${esc(a.ip || "")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  $("#notifBtn").addEventListener("click", async () => {
    const rows = await api("/api/admin/notifications");
    $("#detail").innerHTML = `<h2 class="admin-h1">Alerts</h2>${rows.length ? rows.map(n => `<div class="admin-card ${n.read_at ? "muted" : ""}"><p><b>${esc(n.title)}</b> <span class="muted">${date(n.created_at)}</span></p><p class="pre">${esc(n.body)}</p>${n.order_id ? `<button class="admin-btn ghost" data-open="${n.order_id}">Open order</button>` : ""}</div>`).join("") : '<p class="muted">No alerts.</p>'}`;
    drawer.hidden = false;
    document.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openOrder(Number(b.dataset.open))));
    await post("/api/admin/notifications/read"); loadDashboard();
  });

  $("#logout").addEventListener("click", async () => { try { await post("/api/admin/logout"); } finally { location.href = "/admin-login.html"; } });

  api("/api/admin/session").then(s => { csrf = s.csrf; showTab("dashboard"); setInterval(() => loadDashboard().catch(() => {}), 60_000); }).catch(() => {});
})();
