// Optional marketing tags, loaded by common.js only when the owner configured a public ID AND
// the visitor allows measurement (not opted out, no Global Privacy Control / Do Not Track).
// The CSP forbids inline scripts, so each provider's command queue is created here and its
// official library is loaded from the provider's domain (allowed in the CSP only when configured).
// Only product, value and currency are sent — never names, e-mails or addresses.
(function () {
  const setup = window.HLTagsSetup;
  if (!setup || window.HLTags) return;
  const ids = setup.ids || {};
  const load = (src) => { const s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); };

  if (ids.ga4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ids.ga4, { allow_google_signals: false, allow_ad_personalization_signals: false });
    load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga4)}`);
  }
  if (ids.meta) {
    const f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = "2.0"; f.queue = [];
    // Limited Data Use: Meta applies US state privacy restrictions based on the visitor's location.
    f("dataProcessingOptions", ["LDU"], 0, 0);
    f("init", ids.meta);
    f("track", "PageView");
    load("https://connect.facebook.net/en_US/fbevents.js");
  }
  if (ids.tiktok) {
    const name = "ttq";
    window.TiktokAnalyticsObject = name;
    const t = window[name] = window[name] || [];
    t.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    t.setAndDefer = function (o, m) { o[m] = function () { o.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (const m of t.methods) t.setAndDefer(t, m);
    t.instance = function (id) { const e = t._i[id] || []; for (const m of t.methods) t.setAndDefer(e, m); return e; };
    t.load = function (id) {
      const u = "https://analytics.tiktok.com/i18n/pixel/events.js";
      t._i = t._i || {}; t._i[id] = []; t._i[id]._u = u; t._t = t._t || {}; t._t[id] = +new Date(); t._o = t._o || {}; t._o[id] = {};
      load(`${u}?sdkid=${encodeURIComponent(id)}&lib=${name}`);
    };
    t.load(ids.tiktok);
    t.page();
  }
  if (ids.pinterest) {
    const p = window.pintrk = function () { p.queue.push(Array.prototype.slice.call(arguments)); };
    p.queue = []; p.version = "3.0";
    p("load", ids.pinterest);
    p("page");
    load("https://s.pinimg.com/ct/core.js");
  }

  const money = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);
  function event(name, props) {
    if (!setup.allowed()) return; // the visitor may have opted out since the page loaded
    const d = props || {};
    const value = money(d.value);
    const common = { currency: "USD", ...(value !== undefined ? { value } : {}) };
    const item = d.item_id ? [{ item_id: String(d.item_id), item_variant: d.variant ? String(d.variant) : undefined, quantity: d.quantity || 1 }] : undefined;
    const map = {
      view_item: { ga4: "view_item", meta: "ViewContent", tiktok: "ViewContent", pinterest: "pagevisit" },
      add_to_cart: { ga4: "add_to_cart", meta: "AddToCart", tiktok: "AddToCart", pinterest: "addtocart" },
      begin_checkout: { ga4: "begin_checkout", meta: "InitiateCheckout", tiktok: "InitiateCheckout" },
      sign_up: { ga4: "sign_up", meta: "Lead", tiktok: "CompleteRegistration", pinterest: "signup" },
      purchase: { ga4: "purchase", meta: "Purchase", tiktok: "CompletePayment", pinterest: "checkout" },
    }[name];
    if (!map) return;
    if (ids.ga4 && map.ga4) window.gtag("event", map.ga4, { ...common, ...(item ? { items: item } : {}), ...(d.transaction_id ? { transaction_id: d.transaction_id } : {}), ...(d.method ? { method: d.method } : {}) });
    if (ids.meta && map.meta) window.fbq("track", map.meta, { ...common, content_type: "product", ...(d.item_id ? { content_ids: [String(d.item_id)] } : {}) }, d.transaction_id ? { eventID: d.transaction_id } : undefined);
    if (ids.tiktok && map.tiktok) window.ttq.track(map.tiktok, { ...common, content_type: "product", ...(d.item_id ? { content_id: String(d.item_id) } : {}) }, d.transaction_id ? { event_id: d.transaction_id } : undefined);
    if (ids.pinterest && map.pinterest) window.pintrk("track", map.pinterest, { ...common, ...(d.transaction_id ? { order_id: d.transaction_id, event_id: d.transaction_id } : {}) });
  }

  window.HLTags = { event };
  for (const [n, p] of (setup.queue || []).splice(0)) event(n, p);
})();
