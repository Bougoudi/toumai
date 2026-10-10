// Shared storefront code: header/footer, mobile menu, cart storage, helpers.
(function () {
  const CART_KEY = "hl_cart_v1";
  const fmt = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);

  const storage = {
    get() { try { const v = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } },
    set(v) { try { localStorage.setItem(CART_KEY, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const cart = {
    items() { return storage.get().filter(i => i && typeof i.variantId === "string" && Number.isInteger(i.quantity) && i.quantity > 0); },
    count() { return cart.items().reduce((s, i) => s + i.quantity, 0); },
    add(variantId, quantity, max) {
      const items = cart.items();
      const line = items.find(i => i.variantId === variantId);
      if (line) line.quantity = Math.min(max, line.quantity + quantity); else items.push({ variantId, quantity: Math.min(max, quantity) });
      storage.set(items); cart.render();
    },
    setQty(variantId, quantity, max) {
      const items = cart.items().map(i => i.variantId === variantId ? { ...i, quantity: Math.max(0, Math.min(max, quantity)) } : i).filter(i => i.quantity > 0);
      storage.set(items); cart.render();
    },
    clear() { storage.set([]); cart.render(); },
    render() { document.querySelectorAll("[data-cart-count]").forEach(el => { const n = cart.count(); el.textContent = n; el.hidden = n === 0; }); },
  };

  let configPromise = null;
  const config = () => (configPromise ||= fetch("/api/config").then(r => r.json()));
  let catalogPromise = null;
  const catalog = () => (catalogPromise ||= fetch("/api/catalog").then(r => r.json()));

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) n.append(c);
    return n;
  }

  function toast(message) {
    let t = document.getElementById("toast");
    if (!t) { t = el("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
    t.textContent = message; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 4200);
  }

  // ------------------------------------------------------------ analytics & privacy choices
  // First-party and cookieless. Nothing is sent when the visitor declines, when the
  // browser sends Global Privacy Control or Do Not Track, or — in opt-in mode — before
  // the visitor accepts. Only whitelisted, non-personal properties are ever sent.
  const CHOICE_KEY = "hl_analytics_choice";
  const choice = {
    get() { try { return localStorage.getItem(CHOICE_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(CHOICE_KEY, v); } catch { /* private mode: choice lasts for this page */ } choice.memory = v; },
    memory: null,
  };
  const browserOptOut = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";
  let analyticsCfg = null;
  const queue = [];
  function analyticsAllowed() {
    if (!analyticsCfg || !analyticsCfg.enabled || browserOptOut()) return false;
    const c = choice.memory || choice.get();
    if (c === "denied") return false;
    return analyticsCfg.consentMode === "opt-in" ? c === "granted" : true;
  }
  const PROP_RULES = { item_id: "id", variant: "id", quantity: "int", value: "money", currency: "currency" };
  function cleanProps(d) {
    const out = {};
    for (const [k, kind] of Object.entries(PROP_RULES)) {
      const v = d && d[k];
      if (kind === "id" && typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v)) out[k] = v;
      if (kind === "int" && Number.isInteger(v) && v > 0 && v <= 100) out[k] = v;
      if (kind === "money" && typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 100) / 100;
      if (kind === "currency" && v === "USD") out[k] = v;
    }
    return out;
  }
  function send(payload) {
    if (!analyticsAllowed()) return;
    const body = JSON.stringify({ ...payload, p: location.pathname });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/collect", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall back */ }
    fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
  }
  function track(name, props) {
    const p = { t: "event", n: name, d: cleanProps(props) };
    if (!analyticsCfg) queue.push(p); else send(p);
  }
  // Campaign tags (utm_*) from the landing URL are kept for this browser session only, and
  // only when analytics are allowed. They are attached to the first page view and to the
  // order, so campaigns can be compared. Format is checked again on the server.
  const UTM_KEY = "hl_utm";
  const UTM_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
  function readUtm() {
    const q = new URLSearchParams(location.search); const u = {};
    for (const k of ["source", "medium", "campaign", "content"]) {
      const v = (q.get(`utm_${k}`) || "").trim().toLowerCase();
      if (UTM_RE.test(v)) u[k] = v;
    }
    return u.source || u.campaign ? u : null;
  }
  function campaign() {
    if (!analyticsAllowed()) return null;
    try { return JSON.parse(sessionStorage.getItem(UTM_KEY) || "null"); } catch { return null; }
  }
  function pageview() {
    let u = null;
    const fresh = readUtm();
    if (fresh && analyticsAllowed()) {
      try { if (!sessionStorage.getItem(UTM_KEY)) sessionStorage.setItem(UTM_KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
      u = fresh;
    }
    send({ t: "pageview", r: document.referrer || "", ...(u ? { u } : {}) });
  }

  function privacyPanel(force) {
    if (!analyticsCfg || !analyticsCfg.enabled) return;
    document.getElementById("privacy-choices")?.remove();
    const c = choice.memory || choice.get();
    if (!force && (analyticsCfg.consentMode !== "opt-in" || c || browserOptOut())) return;
    const status = browserOptOut() ? "Your browser sends a privacy signal (Global Privacy Control or Do Not Track), so analytics stay off."
      : analyticsAllowed() ? "Analytics are currently ON." : "Analytics are currently OFF.";
    const panel = el("section", { id: "privacy-choices", class: "privacy-choices", role: "dialog", "aria-label": "Privacy choices" },
      el("p", { class: "privacy-title", text: "Privacy choices" }),
      el("p", { text: "We'd like to measure visits with our own cookie-free analytics: pages viewed, approximate country and shopping steps. No cookies, no advertising, and no names, emails or addresses. " },
        el("a", { href: "/privacy#analytics", text: "Learn more" })),
      force ? el("p", { class: "micro", text: status }) : null,
      el("div", { class: "privacy-actions" },
        el("button", { type: "button", class: "button", "data-choice": "granted", text: "Allow analytics", disabled: browserOptOut() }),
        el("button", { type: "button", class: "button secondary", "data-choice": "denied", text: "Decline" })));
    panel.addEventListener("click", (e) => {
      const v = e.target.getAttribute && e.target.getAttribute("data-choice");
      if (!v) return;
      const before = analyticsAllowed();
      choice.set(v); panel.remove();
      if (!before && analyticsAllowed()) { pageview(); queue.splice(0).forEach(send); }
      toast(v === "granted" ? "Thanks — analytics allowed." : "Analytics declined. Nothing will be measured on this browser.");
    });
    document.body.append(panel);
  }

  const NAV = [["/product", "Shop"], ["/#story", "Our Story"], ["/faq", "FAQ"], ["/contact", "Contact"]];

  function header() {
    const menu = el("nav", { id: "site-nav", class: "site-nav", "aria-label": "Main" },
      NAV.map(([href, label]) => el("a", { href, text: label })));
    const toggle = el("button", { class: "menu-toggle", "aria-controls": "site-nav", "aria-expanded": "false", "aria-label": "Open menu" },
      el("span"), el("span"), el("span"));
    toggle.addEventListener("click", () => {
      const open = document.body.classList.toggle("menu-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    menu.addEventListener("click", (e) => { if (e.target.tagName === "A") document.body.classList.remove("menu-open"); });
    const cartLink = el("a", { class: "cart-link", href: "/cart", "aria-label": "Cart" },
      el("span", { text: "Cart" }), el("span", { class: "cart-count", "data-cart-count": "", hidden: true }));
    return el("header", { class: "site-header" },
      toggle,
      el("a", { class: "brand", href: "/" }, "HavenLume", el("span", { text: "HOME COMFORT" })),
      menu,
      cartLink);
  }

  // Payment logos only while card payment is actually open (never in demo mode).
  function paymentIcons(cfg, className) {
    if (!cfg || !cfg.checkoutEnabled) return null;
    const list = (cfg && cfg.paymentMethods) || [];
    if (!list.length) return null;
    return el("ul", { class: `payment-icons ${className || ""}`, "aria-label": "Accepted payment methods" },
      list.map(m => el("li", {}, el("img", { src: m.icon, alt: m.name, title: m.name, width: "38", height: "24", loading: "lazy" }))));
  }

  function footer(cfg) {
    const year = new Date().getFullYear();
    return el("footer", {},
      el("a", { class: "brand footer-brand", href: "/" }, "HavenLume", el("span", { text: "HOME COMFORT" })),
      el("p", { text: "Comfort for the moments that matter." }),
      el("div", { class: "footer-links" },
        [["/shipping", "Shipping"], ["/returns", "Returns"], ["/privacy", "Privacy"], ["/terms", "Terms of Sale"], ["/faq", "FAQ"], ["/contact", "Contact"]]
          .map(([href, label]) => el("a", { href, text: label })),
        el("button", { type: "button", class: "footer-link-btn", text: "Privacy choices", onclick: () => privacyPanel(true) })),
      paymentIcons(cfg),
      el("small", { text: `© ${year} ${cfg.businessName || "HavenLume"}. All prices in USD.` }));
  }

  async function mount() {
    const top = document.getElementById("site-header");
    if (top) top.replaceWith(header());
    cart.render();
    const cfg = await config().catch(() => ({}));
    const bottom = document.getElementById("site-footer");
    if (bottom) bottom.replaceWith(footer(cfg));
    analyticsCfg = cfg.analytics || { enabled: false };
    if (analyticsAllowed()) { pageview(); queue.splice(0).forEach(send); } else { queue.length = 0; }
    privacyPanel(false);
    const bar = document.querySelector(".announcement");
    if (bar && cfg.banner) {
      // Promo banner set in the admin; it only exists while its dates (and its code) are valid.
      const b = cfg.banner;
      const content = [b.link ? el("a", { href: b.link, text: b.text }) : el("span", { text: b.text })];
      if (b.promo) {
        content.push(el("span", { class: "promo-chip", text: `Code ${b.promo.code}` }));
        const det = el("details", { class: "promo-terms" }, el("summary", { text: "Terms" }), el("span", { text: b.promo.conditions }));
        content.push(det);
      }
      bar.replaceChildren(...content); bar.classList.add("promo");
    }
    if (bar && (cfg.checkoutMode === "sandbox" || cfg.checkoutMode === "demo")) {
      const note = cfg.checkoutMode === "sandbox" ? "Test mode — payments use the iyzico sandbox, no real charges" : "Preview store — orders are not charged or shipped yet";
      if (cfg.banner) bar.after(el("div", { class: "preview-bar", text: note })); else bar.textContent = note;
    }
    document.querySelectorAll("[data-support-email]").forEach(n => {
      if (cfg.supportEmail) { n.textContent = cfg.supportEmail; if (n.tagName === "A") n.href = `mailto:${cfg.supportEmail}`; }
    });
    document.querySelectorAll("[data-return-days]").forEach(n => { n.textContent = cfg.returnWindowDays; });
  }

  // Product facts: confirmed values only. Missing ones are shown as "being confirmed".
  const TBC = "Being confirmed with our supplier";
  function factOr(facts, key, fallback = TBC) { const v = facts && facts[key]; return v && (!Array.isArray(v) || v.length) ? v : fallback; }
  function powerBankText(facts) {
    const v = facts && facts.powerBankIncluded;
    if (v === "yes") return "Yes — a power bank is included in the box.";
    if (v === "no") return "No — a power bank is not included. You need a compatible USB power source" + (facts.powerSource ? ` (${facts.powerSource}).` : ".");
    return "We're confirming this with our supplier. Please contact us before ordering if you need to know.";
  }
  function paymentText(cfg) {
    if (!cfg.checkoutEnabled) return "Online card payment is opening soon. Orders placed today are previews only: no payment is taken and nothing is shipped.";
    const names = (cfg.paymentMethods || []).map(m => m.name).join(", ");
    return `${cfg.checkoutMode === "sandbox" ? "Test mode: " : ""}card payment on the hosted page of our payment provider, iyzico${names ? ` (${names})` : ""}. We never see or store your card number.`;
  }

  // Delivery wording: processing and transit are shown separately, and only once confirmed.
  function deliveryText(facts, cfg) {
    const f = facts || {};
    if (f.handlingTime || f.transitTime) {
      return [f.handlingTime && `Order processing: ${f.handlingTime} after your payment is confirmed.`,
        f.transitTime && `Transit to US addresses: ${f.transitTime} after dispatch.`,
        "These are estimates, not guaranteed delivery dates."].filter(Boolean).join(" ");
    }
    if (cfg && cfg.deliveryVerified) return `Most orders arrive within ${cfg.deliveryMinDays}–${cfg.deliveryMaxDays} business days after dispatch. This is an estimate, not a guaranteed date.`;
    return "Processing and transit times are being confirmed with our supplier, so we don't promise a delivery date yet. Delivery depends on the carrier and your address.";
  }

  // "Common Questions, Clear Answers": the objections buyers raise about USB heated throws,
  // answered only with what is confirmed for our exact model. Shared by /product and /faq.
  function productFaq(facts, cfg) {
    const f = facts || {};
    const days = cfg ? cfg.returnWindowDays : 30;
    const warmData = [f.heatSettings && `Heat settings: ${f.heatSettings}.`, f.heatingZones && `Heating zones: ${f.heatingZones}.`,
      f.temperatureRange && `Temperature range (manufacturer data): ${f.temperatureRange}.`, f.warmUpTime && `Warm-up time (manufacturer data): ${f.warmUpTime}.`].filter(Boolean);
    const runtime = f.powerBankIncluded === "yes"
      ? (f.batteryRuntime ? `With the included power bank${f.batteryCapacity ? ` (${f.batteryCapacity})` : ""}, the manufacturer states: ${f.batteryRuntime}.`
        : "A power bank is included, but its tested runtime is being confirmed with the manufacturer, so we don't quote one yet.")
      : f.powerBankIncluded === "no"
        ? "No power bank is included, so how long it runs depends on the power bank or USB source you use. We don't publish a runtime for power banks we don't sell."
        : "We're confirming with our supplier whether a power bank is included and, if so, its tested runtime. We don't quote a runtime until it's confirmed.";
    const clean = (f.care ? `Manufacturer's instructions: ${f.care.replace(/\n+/g, " ")}` : "The exact cleaning instructions are being confirmed with our supplier. Until then, follow the care label supplied with the product.")
      + (f.machineWashable === "yes" ? " The care label allows machine washing." : f.machineWashable === "no" ? " It is not machine washable." : " Don't machine-wash it unless its care label says you can.")
      + " Always switch it off and disconnect the USB cable first.";
    return [
      { id: "warm", primary: true, q: "Does it get warm enough?",
        a: "It warms up when its USB cable is connected to a compatible power source and it's switched on. "
          + (warmData.length ? warmData.join(" ") + " " : "Its heat settings and temperature data are being confirmed with our supplier, so we make no claim about how warm it gets yet. ")
          + `How warm it feels also depends on the power source, the setting and the room. If it isn't right for you, you can request a return within ${days} days of delivery under our returns policy.` },
      { id: "power-bank", primary: true, q: "Does it come with a power bank?",
        a: powerBankText(f) + (f.powerSource && f.powerBankIncluded !== "no" ? ` Compatible power sources: ${f.powerSource}.` : "") + (f.powerInput ? ` Required input: ${f.powerInput}.` : "") },
      { id: "battery", primary: true, q: "How long does the battery last?", a: runtime },
      { id: "clean", primary: true, q: "How do I clean it?", a: clean },
      { id: "included", primary: true, q: "What exactly is included?",
        a: Array.isArray(f.inBox) && f.inBox.length ? "In the box:" : "The exact box contents are being confirmed with our supplier. Please don't assume any accessory is included.",
        list: Array.isArray(f.inBox) && f.inBox.length ? f.inBox : null,
        after: Array.isArray(f.notIncluded) && f.notIncluded.length ? `Not included (optional, sold separately): ${f.notIncluded.join(", ")}.` : "" },
      { id: "arrive", primary: true, q: "When will my order arrive?",
        a: `We ship to addresses in the United States. ${deliveryText(f, cfg)} You'll receive a tracking link by email as soon as it ships.` },
      { id: "how-it-works", q: "How does the USB-powered blanket work?",
        a: `Connect the throw's USB cable to a compatible USB power source${f.powerSource ? ` (${f.powerSource})` : ""}, then switch it on${f.controls ? `: ${f.controls}` : " as described in the instructions supplied with the product"}.`
          + (f.powerInput ? ` Power input: ${f.powerInput}.` : "") },
      { id: "dimensions", q: "What are the exact dimensions?", a: f.dimensions ? `${f.dimensions}.${f.weight ? ` Weight: ${f.weight}.` : ""}` : "The exact size is being confirmed with our supplier. Contact us if you need it before ordering." },
      { id: "right-item", q: "What if I receive the wrong item or color?",
        a: "Before passing your order to our supplier, we check the product reference, color and quantity against your order. If you still receive the wrong item, contact us within 7 days of delivery with a photo: we'll send a replacement or refund you, including return shipping." },
      { id: "tracking", q: "Can I track my order?", a: "Yes. When your order ships, we email you a tracking link. You can also check your order status from the link in your confirmation email." },
      { id: "returns", q: "What is your return policy?", a: `You can request a return within ${days} days of delivery, under the conditions in our returns policy. Approved refunds go back to the original payment method.` },
      { id: "safety", q: "What safety instructions should I follow?",
        a: "Never use it while sleeping, on infants or young children, or on anyone who can't remove it or switch it off on their own. Use only a compatible USB power source, never use it wet, and disconnect it when not in use."
          + (f.manufacturerWarnings ? ` The manufacturer also says: ${f.manufacturerWarnings.replace(/\n+/g, " ")}` : " Always follow the safety instructions supplied with the product.") },
    ];
  }
  const answerNodes = it => [el("p", { text: it.a }), it.list ? el("ul", {}, it.list.map(t => el("li", { text: t }))) : null, it.after ? el("p", { text: it.after }) : null];
  function renderFaq(container, items) {
    container.replaceChildren(...items.map(it => el("details", { id: "q-" + it.id }, el("summary", { text: it.q }), ...answerNodes(it))));
  }
  // Always-visible answers (no click needed) for the main objections.
  function renderAnswers(container, items) {
    container.replaceChildren(...items.map(it => el("article", { class: "answer-card", id: "a-" + it.id }, el("h3", { text: it.q }), ...answerNodes(it))));
  }

  // "Before You Order": what a buyer must know before paying, on the product, cart and checkout pages.
  function beforeYouOrder(facts, cfg) {
    const f = facts || {};
    const specs = [f.dimensions && `Size ${f.dimensions}`, f.heatSettings && `heat: ${f.heatSettings}`, f.powerInput && `input: ${f.powerInput}`].filter(Boolean);
    const rows = [
      ["Key specs", specs.length ? specs.join(" · ") + "." : "Size, heat settings and power input are being confirmed with our supplier.", "/product#specs"],
      ["Power source", `You need a compatible USB power source${f.powerSource ? ` (${f.powerSource})` : ""}. ${powerBankText(f)}`, "/product#power"],
      ["In the box", Array.isArray(f.inBox) && f.inBox.length ? f.inBox.join(", ") + "." + (Array.isArray(f.notIncluded) && f.notIncluded.length ? ` Not included: ${f.notIncluded.join(", ")}.` : "") : "Exact contents being confirmed. Don't assume any accessory is included.", "/product#in-box"],
      ["Safety", "Never use it while sleeping, on infants or young children, or on anyone who can't remove it. Read the manufacturer's instructions before use.", "/product#safety"],
      ["Delivery & returns", `${deliveryText(f, cfg)} Tracking by email. ${cfg ? cfg.returnWindowDays : 30}-day returns; wrong or damaged items are on us.`, "/shipping"],
      ["Questions?", cfg && cfg.supportEmail ? `Write to ${cfg.supportEmail} or use our contact form.` : "Use our contact form — we answer with what our supplier has confirmed.", "/contact"],
    ];
    return el("section", { class: "before-order", "aria-labelledby": "beforeOrderTitle" },
      el("h2", { id: "beforeOrderTitle", text: "Before You Order" }),
      el("dl", {}, rows.map(([t, d, href]) => el("div", {}, el("dt", { text: t }), el("dd", {}, d + " ", el("a", { href, class: "text-link", text: t === "Questions?" ? "Contact us" : "Details" }))))));
  }

  window.HL = { TBC, factOr, powerBankText, paymentText, deliveryText, productFaq, renderFaq, renderAnswers, beforeYouOrder, cart, config, catalog, fmt, el, toast, track, paymentIcons, campaign, privacyPanel, _analyticsAllowed: analyticsAllowed };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
