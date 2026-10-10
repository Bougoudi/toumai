(async function () {
  const { el, fmt, cart, toast } = HL;
  const [p, cfg] = await Promise.all([HL.catalog(), HL.config()]);
  document.getElementById("price").textContent = fmt(p.priceCents);
  HL.track("view_item", { item_id: p.id, value: p.priceCents / 100, currency: "USD" });

  // Gallery
  const main = document.getElementById("mainImage");
  const thumbs = document.getElementById("thumbs");
  p.images.forEach((img, i) => {
    const b = el("button", { type: "button", class: "thumb" + (i === 0 ? " active" : ""), "aria-label": `Show photo ${i + 1}: ${img.alt}`, role: "listitem" },
      el("img", { src: img.thumb || img.src, alt: "", loading: "lazy", width: "84", height: "64" }));
    b.addEventListener("click", () => {
      main.removeAttribute("srcset"); main.src = img.src; main.alt = img.alt;
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
    // Be explicit when the gallery doesn't show the color being bought.
    const note = document.getElementById("photoNote");
    if (note) note.textContent = selected && !selected.hasPhoto
      ? `No photo of ${selected.name} yet — the photos show the Camel Brown color. Same product, ${selected.name.toLowerCase()} color.`
      : "Photos show the Camel Brown color.";
    note?.classList.toggle("photo-warning", Boolean(selected && !selected.hasPhoto));
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
    HL.track("add_to_cart", { item_id: p.id, variant: selected.id, quantity: Number(qty.value), value: p.priceCents * Number(qty.value) / 100, currency: "USD" });
    toast(`Added ${qty.value} × ${selected.name} to your cart.`);
    addBtn.innerHTML = "Added — view cart <span>↗</span>";
    addBtn.onclick = () => { location.href = "/cart"; };
  });

  const ship = cfg.shippingCents > 0 ? `Shipping ${fmt(cfg.shippingCents)}` : "Free shipping";
  document.getElementById("shipNote").textContent = `${ship} to the United States · ${cfg.returnWindowDays}-day returns · tracking by email`;
  document.getElementById("payNote").textContent = HL.paymentText(cfg);
  document.getElementById("priceLabel").textContent = "Launch price";
  document.getElementById("shipDetail").textContent = `We ship to addresses in the United States. ${HL.deliveryText(p.facts, cfg)} ${cfg.shippingCents > 0 ? `Shipping is ${fmt(cfg.shippingCents)} per order.` : "Shipping is included in the price."}`;

  // Confirmed product facts. Anything missing stays visibly "being confirmed".
  const f = p.facts || {};
  document.querySelectorAll("[data-fact]").forEach(n => { const v = f[n.dataset.fact]; if (v) n.textContent = v; });
  document.querySelectorAll('[data-fact-answer="powerBankIncluded"]').forEach(n => { n.textContent = HL.powerBankText(f); });
  document.getElementById("beforeOrder").replaceChildren(HL.beforeYouOrder(f, cfg));

  // Battery rows only apply when a power bank is (or may be) part of what we sell.
  const battery = f.powerBankIncluded === "no" ? [] : ["batteryCapacity", "batteryRuntime"];
  const specRows = ["dimensions", "weight", "materials", "powerInput", "powerSource", "powerBankIncluded", ...battery, "cableLength",
    "heatSettings", "heatingZones", "temperatureRange", "warmUpTime", "controls", "autoShutoff", "machineWashable", "warranty", "countryOfOrigin"];
  const choice = { powerBankIncluded: { yes: "Yes — included", no: "No — sold separately" }, machineWashable: { yes: "Yes — per the care label", no: "No" } };
  document.getElementById("specTable").replaceChildren(...specRows.map(k => {
    const v = choice[k] ? choice[k][f[k]] : f[k];
    return el("tr", { class: v ? "" : "tbc" }, el("th", { scope: "row", text: (p.factLabels && p.factLabels[k]) || k }),
      el("td", { text: v || HL.TBC }));
  }));
  if (Array.isArray(f.inBox) && f.inBox.length) document.getElementById("boxList").replaceChildren(...f.inBox.map(t => el("li", { text: t })));
  if (Array.isArray(f.notIncluded) && f.notIncluded.length) {
    document.getElementById("notIncludedList").replaceChildren(...f.notIncluded.map(t => el("li", { text: t })));
    document.getElementById("notIncludedWrap").hidden = false;
  }
  if (f.care) document.getElementById("fitCare").textContent = `${f.care.replace(/\n+/g, " ")} Always disconnect the USB cable first.`;
  if (f.manufacturerWarnings) {
    document.getElementById("mfrWarningsList").replaceChildren(...f.manufacturerWarnings.split("\n").map(t => t.trim()).filter(Boolean).map(t => el("li", { text: t })));
    document.getElementById("mfrWarnings").hidden = false;
  }
  const faq = HL.productFaq(f, cfg);
  HL.renderAnswers(document.getElementById("clearAnswers"), faq.filter(q => q.primary));
  HL.renderFaq(document.getElementById("productFaq"), faq.filter(q => !q.primary));
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView();

  // Sticky buy bar (mobile): mirrors the main button, shown once it scrolls out of view.
  const sticky = document.getElementById("stickyBuy");
  document.getElementById("stickyPrice").textContent = fmt(p.priceCents);
  const syncSticky = () => { document.getElementById("stickyVariant").textContent = selected ? ` · ${selected.name}` : ""; };
  syncSticky(); wrap.addEventListener("click", syncSticky);
  document.getElementById("stickyAdd").addEventListener("click", () => {
    if (addBtn.disabled) return;
    if (addBtn.textContent.startsWith("Added")) { location.href = "/cart"; return; }
    addBtn.click();
    document.getElementById("stickyAdd").textContent = "View cart";
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => sticky.classList.toggle("visible", !e.isIntersecting)).observe(addBtn);
  } else sticky.classList.add("visible");
})().catch(() => HL.toast("Could not load the product. Please refresh."));
