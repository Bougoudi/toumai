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
  function pageview() { send({ t: "pageview", r: document.referrer || "" }); }

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

  function footer(cfg) {
    const year = new Date().getFullYear();
    return el("footer", {},
      el("a", { class: "brand footer-brand", href: "/" }, "HavenLume", el("span", { text: "HOME COMFORT" })),
      el("p", { text: "Comfort for the moments that matter." }),
      el("div", { class: "footer-links" },
        [["/shipping", "Shipping"], ["/returns", "Returns"], ["/privacy", "Privacy"], ["/terms", "Terms of Sale"], ["/faq", "FAQ"], ["/contact", "Contact"]]
          .map(([href, label]) => el("a", { href, text: label })),
        el("button", { type: "button", class: "footer-link-btn", text: "Privacy choices", onclick: () => privacyPanel(true) })),
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
    if (cfg.checkoutMode === "sandbox" || cfg.checkoutMode === "demo") {
      const bar = document.querySelector(".announcement");
      if (bar) bar.textContent = cfg.checkoutMode === "sandbox" ? "Test mode — payments use the iyzico sandbox, no real charges" : "Preview store — orders are not charged or shipped yet";
    }
    document.querySelectorAll("[data-support-email]").forEach(n => {
      if (cfg.supportEmail) { n.textContent = cfg.supportEmail; if (n.tagName === "A") n.href = `mailto:${cfg.supportEmail}`; }
    });
    document.querySelectorAll("[data-return-days]").forEach(n => { n.textContent = cfg.returnWindowDays; });
  }

  window.HL = { cart, config, catalog, fmt, el, toast, track, privacyPanel, _analyticsAllowed: analyticsAllowed };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
