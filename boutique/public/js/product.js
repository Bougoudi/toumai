(async function () {
  const { el, fmt, cart, toast } = HL;
  const [p, cfg] = await Promise.all([HL.catalog(), HL.config()]);
  document.getElementById("price").textContent = fmt(p.priceCents);

  // Gallery
  const main = document.getElementById("mainImage");
  const thumbs = document.getElementById("thumbs");
  p.images.forEach((img, i) => {
    const b = el("button", { type: "button", class: "thumb" + (i === 0 ? " active" : ""), "aria-label": `Show photo ${i + 1}: ${img.alt}`, role: "listitem" },
      el("img", { src: img.src, alt: "", loading: "lazy" }));
    b.addEventListener("click", () => {
      main.src = img.src; main.alt = img.alt;
      thumbs.querySelectorAll(".thumb").forEach(t => t.classList.toggle("active", t === b));
    });
    thumbs.append(b);
  });

  // Variants: only confirmed, available colors can be selected
  let selected = p.variants.find(v => v.available) || null;
  const wrap = document.getElementById("variants");
  const name = document.getElementById("variantName");
  const addBtn = document.getElementById("addToCart");
  function renderVariants() {
    wrap.replaceChildren(...p.variants.map(v => {
      const b = el("button", { type: "button", class: "swatch" + (selected && v.id === selected.id ? " selected" : ""), disabled: !v.available,
        "aria-pressed": String(Boolean(selected && v.id === selected.id)), title: v.available ? v.name : `${v.name} — coming soon` },
        el("span", { class: "dot", style: `background:${v.swatch}` }), el("span", { text: v.available ? v.name : `${v.name} · coming soon` }));
      b.addEventListener("click", () => { selected = v; renderVariants(); });
      return b;
    }));
    name.textContent = selected ? selected.name : "Unavailable";
    addBtn.disabled = !selected;
  }
  renderVariants();

  // Quantity
  const qty = document.getElementById("qty");
  qty.max = p.maxQtyPerLine;
  const clamp = () => { qty.value = Math.max(1, Math.min(p.maxQtyPerLine, Number.parseInt(qty.value, 10) || 1)); };
  document.getElementById("minus").addEventListener("click", () => { qty.value = Number(qty.value) - 1; clamp(); });
  document.getElementById("plus").addEventListener("click", () => { qty.value = Number(qty.value) + 1; clamp(); });
  qty.addEventListener("change", clamp);

  addBtn.addEventListener("click", () => {
    if (!selected) return;
    clamp();
    cart.add(selected.id, Number(qty.value), p.maxQtyPerLine);
    toast(`Added ${qty.value} × ${selected.name} to your cart.`);
    addBtn.innerHTML = "Added — view cart <span>↗</span>";
    addBtn.onclick = () => { location.href = "/cart"; };
  });

  const ship = cfg.shippingCents > 0 ? `Shipping ${fmt(cfg.shippingCents)}` : "Free shipping";
  document.getElementById("shipNote").textContent = `${ship} to the United States · Secure card checkout · ${cfg.returnWindowDays}-day returns`;
  if (cfg.deliveryVerified) document.getElementById("shipDetail").innerHTML =
    `Usually delivered in ${cfg.deliveryMinDays}–${cfg.deliveryMaxDays} business days after dispatch. See <a href="/shipping">shipping</a> and <a href="/returns">returns</a>.`;
})().catch(() => HL.toast("Could not load the product. Please refresh."));
