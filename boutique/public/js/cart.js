(async function () {
  const { el, fmt, cart } = HL;
  const [p, cfg] = await Promise.all([HL.catalog(), HL.config()]);
  const linesEl = document.getElementById("cartLines");
  const summary = document.getElementById("cartSummary");
  function render() {
    const items = cart.items().map(i => ({ ...i, v: p.variants.find(v => v.id === i.variantId) })).filter(i => i.v);
    if (!items.length) {
      linesEl.replaceChildren(el("p", { class: "lede", text: "Your cart is empty." }), el("a", { class: "button", href: "/product" }, "Shop the throw ", el("span", { text: "↗" })));
      summary.hidden = true; return;
    }
    linesEl.replaceChildren(...items.map(i => {
      const q = el("input", { type: "number", min: "1", max: String(p.maxQtyPerLine), value: String(i.quantity), "aria-label": `Quantity for ${i.v.name}` });
      q.addEventListener("change", () => { cart.setQty(i.variantId, Number.parseInt(q.value, 10) || 1, p.maxQtyPerLine); render(); });
      const rm = el("button", { type: "button", class: "text-link", text: "Remove" });
      rm.addEventListener("click", () => { cart.setQty(i.variantId, 0, p.maxQtyPerLine); render(); });
      return el("div", { class: "cart-line" },
        el("img", { src: p.images[0].src, alt: "" }),
        el("div", {}, el("strong", { text: p.name }), el("p", { class: "muted", text: `Color: ${i.v.name}` }),
          !i.v.available ? el("p", { class: "form-error", text: "No longer available — please remove." }) : null, rm),
        el("div", { class: "cart-qty" }, q),
        el("div", { class: "cart-price", text: fmt(p.priceCents * i.quantity) }));
    }));
    const sub = items.reduce((s, i) => s + p.priceCents * i.quantity, 0);
    document.getElementById("subtotal").textContent = fmt(sub);
    document.getElementById("shipping").textContent = cfg.shippingCents > 0 ? fmt(cfg.shippingCents) : "Free";
    document.getElementById("total").textContent = fmt(sub + cfg.shippingCents);
    summary.hidden = false;
  }
  render();
})();
