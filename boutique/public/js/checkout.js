(async function () {
  const { el, fmt, cart } = HL;
  const [p, cfg] = await Promise.all([HL.catalog(), HL.config()]);
  const items = cart.items().filter(i => p.variants.some(v => v.id === i.variantId));
  if (!items.length) { location.replace("/cart"); return; }

  const state = document.getElementById("state");
  p.states.forEach(s => state.append(el("option", { value: s, text: s })));

  const sub = items.reduce((s, i) => s + p.priceCents * i.quantity, 0);
  let promoCode = "";
  // Totals shown here always come from the server quote (the same calculation as the order).
  async function refreshQuote(code) {
    const r = await fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, promoCode: code || undefined }) });
    const q = await r.json();
    if (!r.ok) throw new Error(q.error || "Could not apply this code.");
    document.getElementById("subtotal").textContent = fmt(q.subtotal_cents);
    document.getElementById("shipping").textContent = q.shipping_cents > 0 ? fmt(q.shipping_cents) : "Free";
    document.getElementById("total").textContent = fmt(q.total_cents);
    const row = document.getElementById("discountRow");
    row.hidden = !q.discount_cents;
    document.getElementById("discount").textContent = `−${fmt(q.discount_cents)}`;
    document.getElementById("discountLabel").textContent = q.promo ? `Discount (${q.promo.code})` : "Discount";
    document.getElementById("promoTerms").textContent = q.promo ? q.promo.conditions : "";
    promoCode = q.promo ? q.promo.code : "";
    return q;
  }
  document.getElementById("promoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("promoError"); err.textContent = "";
    const code = document.getElementById("promoCode").value.trim();
    try { await refreshQuote(code); if (code) HL.toast("Promo code applied."); }
    catch (e2) { err.textContent = e2.message; await refreshQuote("").catch(() => {}); }
  });
  document.getElementById("summaryLines").replaceChildren(...items.map(i => el("div", { class: "summary-row" },
    el("span", { text: `${i.quantity} × ${p.name} — ${p.variants.find(v => v.id === i.variantId).name}` }), el("span", { text: fmt(p.priceCents * i.quantity) }))));
  document.getElementById("subtotal").textContent = fmt(sub);
  document.getElementById("shipping").textContent = cfg.shippingCents > 0 ? fmt(cfg.shippingCents) : "Free";
  document.getElementById("total").textContent = fmt(sub + cfg.shippingCents);
  refreshQuote("").catch(() => {});
  document.getElementById("beforeOrder").append(HL.beforeYouOrder(p.facts, cfg));

  const units = items.reduce((n, i) => n + i.quantity, 0);
  const value = (sub + cfg.shippingCents) / 100;
  HL.track("begin_checkout", { item_id: p.id, quantity: units, value, currency: "USD" });

  const icons = HL.paymentIcons(cfg, "checkout-icons");
  if (icons && cfg.checkoutEnabled) document.getElementById("payNote").after(icons);

  const banner = document.getElementById("modeBanner");
  const btn = document.getElementById("payButton");
  if (cfg.checkoutMode === "sandbox") {
    banner.hidden = false; banner.textContent = "TEST MODE — payments go to the iyzico sandbox. Use an iyzico test card; no real money is charged.";
  } else if (!cfg.checkoutEnabled) {
    banner.hidden = false; banner.textContent = "PREVIEW — online payment is not open yet. Submitting creates a demo order: no payment is taken and nothing is shipped.";
    btn.innerHTML = "Place demo order (no payment) <span>↗</span>";
    document.getElementById("checkoutEyebrow").textContent = "CHECKOUT PREVIEW";
    document.getElementById("payNote").textContent = "Demo orders are for testing only and are never charged or shipped.";
  }

  const form = document.getElementById("checkoutForm");
  const err = document.getElementById("formError");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const customer = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    HL.track("add_payment_info", { item_id: p.id, quantity: units, value, currency: "USD" });
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer, items, promoCode: promoCode || undefined, utm: HL.campaign() || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Checkout failed. Please try again.");
      if (j.paymentPageUrl) { location.href = j.paymentPageUrl; return; }
      cart.clear();
      location.href = `/order-status?order=${encodeURIComponent(j.orderNumber)}&demo=1`;
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
  });
})();
