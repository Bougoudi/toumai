(async function () {
  const { el, fmt, cart } = HL;
  const [p, cfg] = await Promise.all([HL.catalog(), HL.config()]);
  const items = cart.items().filter(i => p.variants.some(v => v.id === i.variantId));
  if (!items.length) { location.replace("/cart"); return; }

  const state = document.getElementById("state");
  p.states.forEach(s => state.append(el("option", { value: s, text: s })));

  const sub = items.reduce((s, i) => s + p.priceCents * i.quantity, 0);
  document.getElementById("summaryLines").replaceChildren(...items.map(i => el("div", { class: "summary-row" },
    el("span", { text: `${i.quantity} × ${p.name} — ${p.variants.find(v => v.id === i.variantId).name}` }), el("span", { text: fmt(p.priceCents * i.quantity) }))));
  document.getElementById("subtotal").textContent = fmt(sub);
  document.getElementById("shipping").textContent = cfg.shippingCents > 0 ? fmt(cfg.shippingCents) : "Free";
  document.getElementById("total").textContent = fmt(sub + cfg.shippingCents);

  const banner = document.getElementById("modeBanner");
  const btn = document.getElementById("payButton");
  if (cfg.checkoutMode === "sandbox") {
    banner.hidden = false; banner.textContent = "TEST MODE — payments go to the iyzico sandbox. Use an iyzico test card; no real money is charged.";
  } else if (!cfg.checkoutEnabled) {
    banner.hidden = false; banner.textContent = "PREVIEW — online payment is not open yet. Submitting creates a demo order: no payment is taken and nothing is shipped.";
    btn.innerHTML = "Place demo order (no payment) <span>↗</span>";
    document.getElementById("payNote").textContent = "Demo orders are for testing only and are never charged or shipped.";
  }

  const form = document.getElementById("checkoutForm");
  const err = document.getElementById("formError");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const customer = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer, items }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Checkout failed. Please try again.");
      if (j.paymentPageUrl) { location.href = j.paymentPageUrl; return; }
      cart.clear();
      location.href = `/order-status?order=${encodeURIComponent(j.orderNumber)}&demo=1`;
    } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
  });
})();
