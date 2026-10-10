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
          .map(([href, label]) => el("a", { href, text: label }))),
      el("small", { text: `© ${year} ${cfg.businessName || "HavenLume"}. All prices in USD.` }));
  }

  async function mount() {
    const top = document.getElementById("site-header");
    if (top) top.replaceWith(header());
    cart.render();
    const cfg = await config().catch(() => ({}));
    const bottom = document.getElementById("site-footer");
    if (bottom) bottom.replaceWith(footer(cfg));
    if (cfg.checkoutMode === "sandbox" || cfg.checkoutMode === "demo") {
      const bar = document.querySelector(".announcement");
      if (bar) bar.textContent = cfg.checkoutMode === "sandbox" ? "Test mode — payments use the iyzico sandbox, no real charges" : "Preview store — orders are not charged or shipped yet";
    }
    document.querySelectorAll("[data-support-email]").forEach(n => {
      if (cfg.supportEmail) { n.textContent = cfg.supportEmail; if (n.tagName === "A") n.href = `mailto:${cfg.supportEmail}`; }
    });
    document.querySelectorAll("[data-return-days]").forEach(n => { n.textContent = cfg.returnWindowDays; });
  }

  window.HL = { cart, config, catalog, fmt, el, toast };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
