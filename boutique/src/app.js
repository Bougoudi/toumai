// HTTP layer. Business rules live in orders.js; this file wires routes, security and auth.
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { catalog } = require("./catalog");
const { getSettings, DEFAULT_SETTINGS } = require("./db");
const { dashboard, orderProfit, referenceUnitCostCents, unitEconomics } = require("./profit");
const iyzico = require("./iyzico");
const notify = require("./notify");
const auth = require("./auth");
const orders = require("./orders");
const backup = require("./backup");
const analytics = require("./analytics");
const promotions = require("./promotions");
const marketing = require("./marketing");
const seo = require("./seo");
const productFacts = require("./product-facts");
const orderChecks = require("./order-checks");
const reviews = require("./reviews");
const newsletter = require("./newsletter");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Signs order-status links. Without STATUS_LINK_SECRET a per-process secret is used,
// so old links only lose the item/tracking details after a restart.
const STATUS_SECRET = process.env.STATUS_LINK_SECRET || crypto.randomBytes(32).toString("hex");
const statusKey = (orderNumber) => crypto.createHmac("sha256", STATUS_SECRET).update(orderNumber).digest("hex").slice(0, 32);

function createApp({ cfg, db, log = console }) {
  // E-mail list: additive table + welcome promo recreated from the configuration on every start.
  if (cfg.newsletter.enabled) { newsletter.ensureSchema(db); newsletter.ensureWelcomePromo(db, cfg); }
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", 1);

  const tagCsp = require("./tags").csp(cfg.tags);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", ...tagCsp.script],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", ...tagCsp.img],
        "connect-src": ["'self'", ...tagCsp.connect],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": cfg.production ? [] : null,
      },
    },
    hsts: cfg.production,
  }));
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  // Browsers send Origin on cross-site POSTs: reject them (CSRF defence in depth).
  // iyzico's callback/webhook are cross-origin by design and are verified with iyzico.
  const EXEMPT = new Set(["/api/checkout/iyzico/callback", "/api/webhooks/iyzico"]);
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || EXEMPT.has(req.path)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.headers.host}` && origin !== cfg.publicUrl) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    next();
  });

  const limiter = (windowMs, limit, extra = {}) => rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, ...extra });
  app.use("/api/", limiter(60_000, 120));

  const requireAdmin = auth.requireAdmin(db, cfg);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const adminAction = (action, fn) => wrap(async (req, res) => {
    const result = await fn(req, res);
    auth.audit(db, req.admin.username, action, req.params.id ? `order:${req.params.id}` : null, summarize(req.body), req.ip);
    return result;
  });
  const orderId = (req) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new orders.OrderError(400, "Invalid order id.");
    return id;
  };

  // ------------------------------------------------------------- pages
  app.get(["/admin.html", "/admin"], requireAdmin, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
  // Public pages get canonical URLs, social previews and JSON-LD injected server-side.
  app.use(seo.pageMiddleware(cfg));
  app.get("/robots.txt", (req, res) => res.type("text/plain").send(seo.robots(cfg, req)));
  app.get("/sitemap.xml", (req, res) => res.type("application/xml").send(seo.sitemap(cfg, req)));
  app.get("/feeds/google-merchant.xml", (_req, res) => {
    const xml = seo.merchantFeed(cfg);
    if (!xml) return res.status(503).type("text/plain").send("Set PUBLIC_URL to publish the product feed.");
    res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(xml);
  });
  app.use("/images", express.static(path.join(PUBLIC_DIR, "images"), { maxAge: "7d" }));
  // Review files are not served while reviews are disabled.
  if (!cfg.reviewsEnabled) app.use("/review-policy.html", (_req, res) => res.status(404).type("text/plain").send("Not found"));
  app.use(express.static(PUBLIC_DIR, { extensions: ["html"], index: "index.html" }));

  // ------------------------------------------------------------- public API
  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/config", (_req, res) => {
    const s = iyzico.checkoutStatus(cfg);
    const p = catalog(cfg);
    res.json({
      storeName: cfg.storeName, currency: cfg.currency, price: p.priceCents / 100, priceCents: p.priceCents,
      shippingCents: Math.round(cfg.shippingUsd * 100),
      checkoutEnabled: s.enabled, checkoutMode: s.mode, checkoutSandbox: s.mode === "sandbox",
      livePaymentsEnabled: cfg.livePaymentsEnabled, productComplianceVerified: cfg.productComplianceVerified,
      deliveryMinDays: cfg.deliveryMinDays, deliveryMaxDays: cfg.deliveryMaxDays, deliveryVerified: cfg.deliveryVerified,
      returnWindowDays: cfg.returnWindowDays, supportEmail: cfg.supportEmail,
      businessName: cfg.businessName, businessAddress: cfg.businessAddress,
      analytics: { enabled: cfg.analytics.enabled, consentMode: cfg.analytics.consentMode },
      paymentMethods: cfg.paymentMethods,
      // Verified Purchase links need a working e-mail provider; the review form says so when it's missing.
      newsletter: cfg.newsletter.enabled ? { percent: cfg.newsletter.welcomePercent } : null,
      tags: cfg.tags,
      reviewsEnabled: cfg.reviewsEnabled,
      reviewVerificationAvailable: cfg.reviewsEnabled && notify.emailConfigured(cfg) && Boolean(cfg.publicUrl),
      banner: marketing.activeBanner(db),
    });
  });

  app.get("/api/catalog", (_req, res) => {
    const p = catalog(cfg);
    res.json({ id: p.id, name: p.name, priceCents: p.priceCents, maxQtyPerLine: p.maxQtyPerLine, images: p.images,
      variants: p.variants.map(v => ({ id: v.id, name: v.name, available: v.available, hasPhoto: Boolean(v.hasPhoto), swatch: v.swatch })), states: orders.US_STATES,
      // Only facts confirmed by the owner; anything absent is shown as "being confirmed".
      facts: productFacts.publicFacts(productFacts.get(db)),
      factLabels: Object.fromEntries(productFacts.FIELDS.filter(f => !f.internal).map(f => [f.key, f.label])) });
  });

  const startCheckout = wrap(async (req, res) => {
    const input = orders.validateCheckout(req.body, cfg);
    const status = iyzico.checkoutStatus(cfg);
    if (!status.enabled) {
      const o = orders.createOrder(db, cfg, input, { isTest: true, ip: req.ip });
      return res.status(201).json({ mode: "demo", orderNumber: o.order_number, paymentStatus: "test_unpaid",
        message: "Demo order created. No payment was collected and this order will not be shipped." });
    }
    const o = orders.createOrder(db, cfg, input, { isTest: false, ip: req.ip });
    try {
      const { token, paymentPageUrl } = await iyzico.initializeCheckout(cfg, o, orders.getItems(db, o.id), req.ip);
      db.prepare("UPDATE orders SET iyzico_token=? WHERE id=?").run(token, o.id);
      orders.event(db, o.id, "checkout_started", `iyzico ${status.mode} checkout opened.`);
      res.status(201).json({ mode: status.mode, orderNumber: o.order_number, paymentPageUrl });
    } catch (err) {
      db.prepare("UPDATE orders SET payment_status='failed', updated_at=? WHERE id=?").run(new Date().toISOString(), o.id);
      orders.event(db, o.id, "checkout_failed", String(err.message || err));
      log.error(`iyzico initialize failed for ${o.order_number}: ${err.message || err}`);
      res.status(502).json({ error: "We could not open the secure payment page. Please try again in a moment." });
    }
  });
  // Server-side price quote (with an optional promo code) for the checkout page.
  app.post("/api/quote", limiter(60_000, 30), wrap(async (req, res) => res.json(orders.quote(db, cfg, req.body || {}))));
  app.post("/api/checkout", limiter(60_000, 10), startCheckout);
  app.post("/api/demo-order", limiter(60_000, 10), startCheckout); // kept for the original demo flow

  // iyzico posts the customer's browser here with a token. We re-read the payment from
  // iyzico's API; the redirect itself proves nothing.
  app.post("/api/checkout/iyzico/callback", limiter(60_000, 30), wrap(async (req, res) => {
    const token = String(req.body?.token || "").slice(0, 200);
    const o = token && db.prepare("SELECT * FROM orders WHERE iyzico_token=?").get(token);
    if (!o) return res.redirect(303, "/order-status.html?result=unknown");
    try { await orders.confirmPayment(db, cfg, o, "callback"); } catch (err) { log.error(`iyzico retrieve failed: ${err.message || err}`); }
    res.redirect(303, `/order-status.html?order=${encodeURIComponent(o.order_number)}&k=${statusKey(o.order_number)}`);
  }));

  // iyzico webhook: signature-verified, de-duplicated, and used only as a trigger to
  // re-read the payment from iyzico's API.
  app.post("/api/webhooks/iyzico", limiter(60_000, 120), wrap(async (req, res) => {
    const b = req.body || {};
    const signature = req.get("x-iyz-signature-v3");
    const valid = iyzico.verifyWebhookSignature(cfg, b, signature);
    if (!valid && (cfg.iyzico.requireWebhookSignature || signature)) {
      log.warn("Rejected iyzico webhook with an invalid or missing signature.");
      return res.status(401).json({ error: "Invalid signature." });
    }
    const key = `${b.iyziReferenceCode || ""}:${b.iyziEventType || ""}:${b.status || ""}:${b.token || b.paymentId || ""}`;
    const inserted = db.prepare("INSERT OR IGNORE INTO webhook_events(provider,event_key,received_at,payload) VALUES('iyzico',?,?,?)")
      .run(key, new Date().toISOString(), JSON.stringify(b).slice(0, 4000)).changes;
    if (!inserted) return res.json({ ok: true, duplicate: true });
    const o = b.token ? db.prepare("SELECT * FROM orders WHERE iyzico_token=?").get(String(b.token))
      : db.prepare("SELECT * FROM orders WHERE order_number=?").get(String(b.paymentConversationId || ""));
    let result = "order_not_found";
    if (o) {
      try { result = (await orders.confirmPayment(db, cfg, o, "webhook")).outcome; }
      catch (err) {
        // Forget the event and answer 500 so iyzico's retry is processed, not ignored.
        log.error(`Webhook payment lookup failed: ${err.message || err}`);
        db.prepare("DELETE FROM webhook_events WHERE event_key=?").run(key);
        return res.status(500).json({ error: "Temporary error, please retry." });
      }
    }
    db.prepare("UPDATE webhook_events SET result=? WHERE event_key=?").run(result, key);
    res.json({ ok: true });
  }));

  // Status page data. Item and tracking details only with the signed key from the
  // payment redirect, or with the order's email address.
  app.get("/api/orders/:orderNumber/status", (req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE order_number=?").get(String(req.params.orderNumber).slice(0, 40));
    if (!o) return res.status(404).json({ error: "Order not found." });
    const owner = (req.query.k && auth.safeEqual(String(req.query.k), statusKey(o.order_number))) ||
      (req.query.email && auth.safeEqual(String(req.query.email).trim().toLowerCase(), o.customer_email));
    res.json({
      order_number: o.order_number, is_test: Boolean(o.is_test), payment_status: o.payment_status,
      fulfillment_status: o.fulfillment_status, total_cents: o.total_cents, currency: o.currency,
      ...(owner ? { items: orders.getItems(db, o.id).map(i => ({ name: i.product_name, variant: i.variant_name, quantity: i.quantity })),
        carrier: o.carrier, tracking_number: o.tracking_number, tracking_url: o.tracking_url } : {}),
    });
  });

  // First-party analytics beacon (cookieless). Always 204: the client learns nothing.
  app.post("/api/collect", limiter(60_000, 60), (req, res) => {
    try {
      analytics.collect(db, cfg, req, Boolean(auth.getSession(db, cfg, req)));
    } catch (err) { log.error(`analytics collect failed: ${err.message || err}`); }
    res.status(204).end();
  });

  // ------------------------------------------------------------- e-mail list
  if (cfg.newsletter.enabled) {
    app.post("/api/newsletter/subscribe", limiter(3_600_000, cfg.newsletter.signupLimit), wrap(async (req, res) => {
      res.status(201).json(await newsletter.subscribe(db, cfg, req.body));
    }));
    app.get("/newsletter/unsubscribe", limiter(60_000, 20), (req, res) => {
      const ok = newsletter.unsubscribe(db, req.query.token);
      const msg = ok ? "You're unsubscribed. You won't receive marketing emails from HavenLume anymore."
        : "This unsubscribe link is invalid or was already used. If you still receive our emails, contact us.";
      res.status(ok ? 200 : 400).type("html").set("Cache-Control", "no-store").send(`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Email preferences | HavenLume</title><link rel="stylesheet" href="/styles.css"></head><body><main class="page narrow"><p class="eyebrow">EMAIL PREFERENCES</p><h1 class="page-title">${ok ? "Unsubscribed" : "Link not valid"}</h1><p>${msg}</p><p><a href="/">Back to HavenLume</a></p></main></body></html>`);
    });
    app.get("/api/admin/newsletter", requireAdmin, (_req, res) => res.set("Cache-Control", "no-store").json(newsletter.adminList(db, cfg)));
    app.get("/api/admin/newsletter.csv", requireAdmin, (req, res) => {
      auth.audit(db, req.admin.username, "newsletter_export", null, null, req.ip);
      res.set("Cache-Control", "no-store").type("text/csv").attachment("havenlume-subscribers.csv").send(newsletter.exportCsv(db));
    });
    app.post("/api/admin/newsletter/:id/delete", requireAdmin, wrap(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) throw new newsletter.NewsletterError(400, "Invalid id.");
      newsletter.remove(db, id);
      auth.audit(db, req.admin.username, "newsletter_subscriber_deleted", `subscriber:${id}`, null, req.ip);
      res.json({ ok: true });
    }));
  }

  // ------------------------------------------------------------- reviews (public)
  // Registered only when REVIEWS_ENABLED=true (otherwise 404 and no review tables exist).
  if (cfg.reviewsEnabled) {
    // Only approved reviews and public fields are ever returned here.
    app.get("/api/reviews", (req, res) => res.set("Cache-Control", "no-store").json(reviews.publicList(db, cfg, req.query)));
    app.post("/api/reviews", limiter(15 * 60_000, cfg.reviewSubmitLimit), limiter(24 * 3_600_000, cfg.reviewSubmitLimit * 4), wrap(async (req, res) => {
      res.status(201).json(reviews.submit(db, cfg, req.body));
    }));
    app.post("/api/reviews/verification-request", limiter(3_600_000, cfg.reviewVerifyLimit), wrap(async (req, res) => {
      res.json(await reviews.requestVerification(db, cfg, req.body || {}));
    }));
    app.get("/api/reviews/verification", limiter(60_000, 20), (req, res) => res.set("Cache-Control", "no-store").json(reviews.tokenStatus(db, req.query.token)));
  }

  app.post("/api/contact", limiter(10 * 60_000, 5), wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 120);
    const email = String(b.email || "").trim().slice(0, 254);
    const message = String(b.message || "").trim().slice(0, 4000);
    const orderNumber = String(b.orderNumber || "").trim().slice(0, 40);
    if (!name || !message || message.length < 10) return res.status(400).json({ error: "Please enter your name and a message (10 characters minimum)." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    db.prepare("INSERT INTO messages(name,email,order_number,message,created_at) VALUES(?,?,?,?,?)").run(name, email, orderNumber || null, message, new Date().toISOString());
    await notify.notifyAdmin(db, cfg, { kind: "contact", title: `New message from ${name}`, body: `${email}${orderNumber ? ` · order ${orderNumber}` : ""}\n\n${message}` });
    res.status(201).json({ ok: true });
  }));

  // ------------------------------------------------------------- admin auth
  app.post("/api/admin/login", limiter(15 * 60_000, 10, { skipSuccessfulRequests: true }), (req, res) => {
    if (!cfg.adminPasswordHash) return res.status(503).json({ error: "Admin password hash is not configured. See README." });
    const userOk = auth.safeEqual(String(req.body?.username || ""), cfg.adminUsername);
    const passOk = auth.verifyPassword(String(req.body?.password || "").slice(0, 200), cfg.adminPasswordHash);
    if (!userOk || !passOk) {
      auth.audit(db, String(req.body?.username || "?").slice(0, 60), "login_failed", null, null, req.ip);
      return res.status(401).json({ error: "Invalid credentials." });
    }
    auth.purgeExpired(db);
    const csrf = auth.createSession(db, cfg, req, res);
    auth.audit(db, cfg.adminUsername, "login", null, null, req.ip);
    res.json({ ok: true, csrf });
  });
  app.get("/api/admin/session", requireAdmin, (req, res) => res.json({ username: req.admin.username, csrf: req.admin.csrf }));
  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    auth.audit(db, req.admin.username, "logout", null, null, req.ip);
    auth.destroySession(db, cfg, req, res);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- admin data
  app.get("/api/admin/dashboard", requireAdmin, (_req, res) => {
    const all = db.prepare("SELECT * FROM orders").all();
    const settings = getSettings(db);
    res.json({
      totals: dashboard(all), settings, referenceUnitCostCents: referenceUnitCostCents(settings),
      checkout: iyzico.checkoutStatus(cfg), emailConfigured: notify.emailConfigured(cfg),
      unreadNotifications: db.prepare("SELECT COUNT(*) n FROM notifications WHERE read_at IS NULL").get().n,
      openMessages: db.prepare("SELECT COUNT(*) n FROM messages WHERE handled_at IS NULL").get().n,
      productFactsMissing: productFacts.missing(productFacts.get(db)).length,
      reviewsEnabled: cfg.reviewsEnabled,
      reviewsPending: cfg.reviewsEnabled ? db.prepare("SELECT COUNT(*) n FROM reviews WHERE moderation_status='pending'").get().n : 0,
      ordersOnHold: db.prepare("SELECT COUNT(*) n FROM orders WHERE on_hold=1 AND is_test=0").get().n,
    });
  });

  app.get("/api/admin/analytics", requireAdmin, (req, res) => {
    try {
      res.set("Cache-Control", "no-store").json(analytics.report(db, cfg, req.query));
    } catch (err) {
      if (err instanceof analytics.RangeError400) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  app.get("/api/admin/orders", requireAdmin, (req, res) => {
    const where = []; const vals = [];
    if (req.query.payment) { where.push("payment_status=?"); vals.push(String(req.query.payment)); }
    if (req.query.fulfillment) { where.push("fulfillment_status=?"); vals.push(String(req.query.fulfillment)); }
    if (req.query.tests !== "1") where.push("is_test=0");
    if (req.query.q) {
      const q = `%${String(req.query.q).slice(0, 60)}%`;
      where.push("(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)"); vals.push(q, q, q);
    }
    const rows = db.prepare(`SELECT * FROM orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 500`).all(...vals);
    const items = db.prepare("SELECT order_id, GROUP_CONCAT(quantity || ' × ' || variant_name, ', ') summary FROM order_items GROUP BY order_id").all();
    const byId = new Map(items.map(i => [i.order_id, i.summary]));
    res.json(rows.map(o => ({
      id: o.id, order_number: o.order_number, created_at: o.created_at, is_test: Boolean(o.is_test),
      customer_name: o.customer_name, customer_email: o.customer_email, state: o.state,
      items: byId.get(o.id) || "", total_cents: o.total_cents, payment_status: o.payment_status,
      fulfillment_status: o.fulfillment_status, tracking_number: o.tracking_number, on_hold: Boolean(o.on_hold), profit: orderProfit(o),
    })));
  });

  app.get("/api/admin/orders/:id", requireAdmin, wrap(async (req, res) => {
    const d = orders.orderDetail(db, orderId(req));
    if (!d) return res.status(404).json({ error: "Order not found." });
    res.json(d);
  }));

  app.post("/api/admin/orders/:id/supplier-text", requireAdmin, adminAction("supplier_text_copied", (req, res) => {
    res.json({ text: orders.supplierOrderText(db, cfg, orderId(req), { includePhone: req.body?.includePhone === true }, req.admin.username) });
  }));
  app.post("/api/admin/orders/:id/supplier-order", requireAdmin, adminAction("supplier_order_recorded", (req, res) => {
    orders.recordSupplierOrder(db, orderId(req), req.body || {}, req.admin.username); res.json({ ok: true });
  }));
  app.post("/api/admin/orders/:id/shipment", requireAdmin, adminAction("shipment_recorded", async (req, res) => {
    const { email } = await orders.recordShipment(db, cfg, orderId(req), req.body || {}, req.admin.username);
    res.json({ ok: true, email: { id: email.id, status: email.status, error: email.error, subject: email.subject, body: email.body, to: email.to_addr } });
  }));
  app.post("/api/admin/orders/:id/status", requireAdmin, adminAction("status_changed", (req, res) => {
    orders.changeStatus(db, orderId(req), req.body || {}, req.admin.username); res.json({ ok: true });
  }));
  app.post("/api/admin/orders/:id/costs", requireAdmin, adminAction("costs_updated", (req, res) => {
    orders.updateCosts(db, orderId(req), req.body || {}, req.admin.username); res.json({ ok: true });
  }));
  app.post("/api/admin/orders/:id/refund", requireAdmin, adminAction("refund", async (req, res) => {
    const b = req.body || {};
    const amountCents = Math.round(Number(b.amount) * 100);
    const r = await orders.refundOrder(db, cfg, orderId(req), { amountCents, mode: b.mode, reason: b.reason, requestKey: b.requestKey, actor: req.admin.username, ip: req.ip });
    res.json({ ok: true, duplicate: r.duplicate, payment_status: r.order.payment_status, refunded_cents: r.order.refunded_cents });
  }));
  app.post("/api/admin/orders/:id/verify-payment", requireAdmin, adminAction("payment_reverified", async (req, res) => {
    const o = orders.getOrder(db, orderId(req));
    if (!o) return res.status(404).json({ error: "Order not found." });
    let v;
    try { v = await orders.confirmPayment(db, cfg, o, "admin re-check"); }
    catch (err) { return res.status(502).json({ error: `iyzico lookup failed: ${err.message || err}` }); }
    res.status(v.outcome === "paid" ? 200 : 409).json(v.outcome === "paid" ? { ok: true } : { error: `Not paid: ${v.reason}` });
  }));
  // ------------------------------------------------------------- reviews (admin)
  if (cfg.reviewsEnabled) {
    const reviewId = (req) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) throw new reviews.ReviewError(400, "Invalid review id.");
      return id;
    };
    app.get("/api/admin/reviews", requireAdmin, (req, res) => res.set("Cache-Control", "no-store").json(reviews.adminList(db, req.query)));
    app.get("/api/admin/reviews/:id/moderation-history", requireAdmin, wrap(async (req, res) => res.json(reviews.history(db, reviewId(req)))));
    for (const action of Object.keys(reviews.TRANSITIONS)) {
      app.post(`/api/admin/reviews/:id/${action}`, requireAdmin, wrap(async (req, res) => {
        const id = reviewId(req);
        const status = reviews.moderate(db, id, action, req.body || {}, req.admin.username);
        auth.audit(db, req.admin.username, `review_${action}`, `review:${id}`, req.body?.reason ? String(req.body.reason).slice(0, 40) : null, req.ip);
        res.json({ ok: true, status });
      }));
    }
    app.post("/api/admin/orders/:id/review-request", requireAdmin, adminAction("review_request", async (req, res) => {
      res.json(await reviews.requestReview(db, cfg, orderId(req), req.admin.username));
    }));
  }

  // Supplier preparation checklist and anomalies (holds block supplier order and shipment).
  const loadOrder = (req) => {
    const o = orders.getOrder(db, orderId(req));
    if (!o) throw new orders.OrderError(404, "Order not found.");
    return o;
  };
  app.post("/api/admin/orders/:id/checks", requireAdmin, adminAction("order_check", (req, res) => {
    const o = loadOrder(req);
    orderChecks.setCheck(db, o, orders.getItems(db, o.id), req.body || {}, req.admin.username);
    res.json({ ok: true, checklist: orderChecks.checklist(db, orders.getOrder(db, o.id), orders.getItems(db, o.id)) });
  }));
  app.post("/api/admin/orders/:id/issues", requireAdmin, adminAction("order_issue_opened", (req, res) => {
    const o = loadOrder(req);
    const id = orderChecks.openIssue(db, o, req.body || {}, req.admin.username);
    res.status(201).json({ ok: true, id, on_hold: Boolean(orders.getOrder(db, o.id).on_hold) });
  }));
  app.post("/api/admin/orders/:id/issues/:issueId/resolve", requireAdmin, adminAction("order_issue_resolved", (req, res) => {
    const o = loadOrder(req);
    const issueId = Number(req.params.issueId);
    if (!Number.isInteger(issueId) || issueId <= 0) throw new orders.OrderError(400, "Invalid anomaly id.");
    orderChecks.resolveIssue(db, o, issueId, req.body || {}, req.admin.username);
    res.json({ ok: true, on_hold: Boolean(orders.getOrder(db, o.id).on_hold) });
  }));
  app.post("/api/admin/orders/:id/notes", requireAdmin, adminAction("notes_updated", (req, res) => {
    const id = orderId(req);
    if (!orders.getOrder(db, id)) return res.status(404).json({ error: "Order not found." });
    db.prepare("UPDATE orders SET notes=?, updated_at=? WHERE id=?").run(String(req.body?.notes || "").slice(0, 4000), new Date().toISOString(), id);
    res.json({ ok: true });
  }));

  app.post("/api/admin/emails/:emailId/send", requireAdmin, wrap(async (req, res) => {
    if (!notify.emailConfigured(cfg)) return res.status(409).json({ error: "No email provider configured (RESEND_API_KEY, EMAIL_FROM). Copy the email and send it yourself." });
    const kind = db.prepare("SELECT kind FROM emails WHERE id=?").get(Number(req.params.emailId));
    if (kind && kind.kind.startsWith("review_")) return res.status(409).json({ error: "Review e-mails contain a single-use link that is not stored. Send a new review request instead." });
    const e = await notify.trySend(db, cfg, Number(req.params.emailId));
    if (!e) return res.status(404).json({ error: "Email not found." });
    auth.audit(db, req.admin.username, "email_send", `email:${e.id}`, e.status, req.ip);
    if (e.order_id) orders.event(db, e.order_id, e.status === "sent" ? "email_sent" : "email_failed", `${e.subject} → ${e.to_addr}${e.error ? ` (${e.error})` : ""}`, req.admin.username);
    res.status(e.status === "sent" ? 200 : 502).json({ status: e.status, error: e.error });
  }));
  app.post("/api/admin/emails/:emailId/mark-sent", requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.emailId);
    const e = db.prepare("SELECT * FROM emails WHERE id=?").get(id);
    if (!e) return res.status(404).json({ error: "Email not found." });
    if (e.kind.startsWith("review_")) return res.status(409).json({ error: "Review e-mails can't be sent manually: their single-use link is not stored." });
    db.prepare("UPDATE emails SET status='sent', provider_id='manual', sent_at=? WHERE id=?").run(new Date().toISOString(), id);
    auth.audit(db, req.admin.username, "email_marked_sent_manually", `email:${id}`, null, req.ip);
    if (e.order_id) orders.event(db, e.order_id, "email_sent_manually", `${e.subject} → ${e.to_addr} (sent by the owner)`, req.admin.username);
    res.json({ ok: true });
  }));

  app.get("/api/admin/settings", requireAdmin, (_req, res) => res.json(getSettings(db)));
  app.post("/api/admin/settings", requireAdmin, adminAction("settings_updated", (req, res) => {
    const b = req.body || {};
    const limits = { product_cost_usd: 10000, shipping_cost_usd: 10000, payment_fee_percent: 20, payment_fee_fixed_usd: 100 };
    const up = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (b[k] === undefined) continue;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0 || n > limits[k]) return res.status(400).json({ error: `Invalid value for ${k}.` });
      up.run(k, n.toFixed(2));
    }
    res.json(getSettings(db));
  }));

  // ------------------------------------------------------------- marketing
  const idParam = (req) => { const id = Number.parseInt(req.params.id, 10); if (!(id > 0)) throw new marketing.MarketingError("Invalid id."); return id; };
  app.get("/api/admin/marketing", requireAdmin, (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      options: { channels: marketing.CHANNELS, mediums: marketing.MEDIUMS, angles: marketing.ANGLES, statuses: marketing.STATUSES, defaultSources: marketing.DEFAULT_SOURCE },
      report: marketing.campaignReport(db, cfg),
      content: marketing.listContent(db, cfg),
      promotions: promotions.list(db),
      banner: marketing.getBanner(db),
      bannerLive: marketing.activeBanner(db),
      settings: getSettings(db),
      priceCents: catalog(cfg).priceCents,
      publicUrlConfigured: Boolean(cfg.publicUrl),
    });
  });
  app.post("/api/admin/marketing/campaigns", requireAdmin, adminAction("campaign_created", (req, res) => res.status(201).json({ id: marketing.saveCampaign(db, req.body || {}) })));
  app.post("/api/admin/marketing/campaigns/:id", requireAdmin, adminAction("campaign_updated", (req, res) => res.json({ id: marketing.saveCampaign(db, req.body || {}, idParam(req)) })));
  app.post("/api/admin/marketing/content", requireAdmin, adminAction("content_created", (req, res) => res.status(201).json({ id: marketing.saveContent(db, req.body || {}) })));
  app.post("/api/admin/marketing/content/:id", requireAdmin, adminAction("content_updated", (req, res) => res.json({ id: marketing.saveContent(db, req.body || {}, idParam(req)) })));
  app.post("/api/admin/marketing/content/:id/delete", requireAdmin, adminAction("content_deleted", (req, res) => {
    const n = db.prepare("DELETE FROM content_items WHERE id=?").run(idParam(req)).changes;
    res.status(n ? 200 : 404).json(n ? { ok: true } : { error: "Content item not found." });
  }));
  app.post("/api/admin/marketing/content-starters", requireAdmin, adminAction("content_starters_added", (_req, res) => res.json({ created: marketing.addStarters(db).length })));
  app.post("/api/admin/marketing/promotions", requireAdmin, adminAction("promotion_created", (req, res) => res.status(201).json({ id: promotions.save(db, req.body || {}) })));
  app.post("/api/admin/marketing/promotions/:id", requireAdmin, adminAction("promotion_updated", (req, res) => res.json({ id: promotions.save(db, req.body || {}, idParam(req)) })));
  app.post("/api/admin/marketing/banner", requireAdmin, adminAction("banner_updated", (req, res) => res.json(marketing.saveBanner(db, req.body || {}))));
  app.post("/api/admin/marketing/unit-economics", requireAdmin, (req, res) => {
    const b = req.body || {};
    const c = (v, max) => { const n = Number(v || 0); if (!Number.isFinite(n) || n < 0 || n > max) throw new marketing.MarketingError("Invalid amount."); return Math.round(n * 100); };
    res.json(unitEconomics({ priceCents: b.price === undefined || b.price === "" ? catalog(cfg).priceCents : c(b.price, 10000),
      units: Number(b.units) || 1, discountCents: c(b.discount, 10000), shippingChargedCents: Math.round(cfg.shippingUsd * 100),
      settings: getSettings(db), adPerOrderCents: c(b.adPerOrder, 10000), otherCents: c(b.other, 10000) }));
  });

  // ------------------------------------------------------------- product facts
  app.get("/api/admin/product-facts", requireAdmin, (_req, res) => {
    const facts = productFacts.get(db);
    res.set("Cache-Control", "no-store").json({ fields: productFacts.FIELDS, facts, missing: productFacts.missing(facts) });
  });
  app.post("/api/admin/product-facts", requireAdmin, adminAction("product_facts_updated", (req, res) => {
    const facts = productFacts.save(db, req.body || {});
    res.json({ facts, missing: productFacts.missing(facts) });
  }));

  app.get("/api/admin/notifications", requireAdmin, (_req, res) => res.json(db.prepare("SELECT * FROM notifications ORDER BY id DESC LIMIT 100").all()));
  app.post("/api/admin/notifications/read", requireAdmin, (_req, res) => {
    db.prepare("UPDATE notifications SET read_at=? WHERE read_at IS NULL").run(new Date().toISOString()); res.json({ ok: true });
  });
  app.get("/api/admin/messages", requireAdmin, (_req, res) => res.json(db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 200").all()));
  app.post("/api/admin/messages/:id/handled", requireAdmin, (req, res) => {
    db.prepare("UPDATE messages SET handled_at=? WHERE id=?").run(new Date().toISOString(), Number(req.params.id)); res.json({ ok: true });
  });
  app.get("/api/admin/audit", requireAdmin, (_req, res) => res.json(db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300").all()));
  app.get("/api/admin/backup", requireAdmin, wrap(async (req, res) => {
    const file = await backup.backupNow(db, cfg);
    auth.audit(db, req.admin.username, "backup_downloaded", null, path.basename(file), req.ip);
    res.download(file, path.basename(file));
  }));

  // ------------------------------------------------------------- errors
  app.use("/api/", (_req, res) => res.status(404).json({ error: "Not found." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof newsletter.NewsletterError) return res.status(err.status).json({ error: err.message });
    if (err instanceof reviews.ReviewError) return res.status(err.status).json({ error: err.message, ...(err.errors ? { errors: err.errors } : {}) });
    if (err instanceof orders.OrderError || err instanceof promotions.PromoError || err instanceof marketing.MarketingError || err instanceof productFacts.FactsError || err instanceof orderChecks.CheckError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
    const ref = crypto.randomBytes(4).toString("hex");
    log.error(`[${ref}] ${req.method} ${req.path}: ${err.stack || err.message || err}`);
    res.status(500).json({ error: `Unexpected error (ref ${ref}).` });
  });
  return app;
}

// Audit details without secrets or bulky fields.
function summarize(body) {
  if (!body || typeof body !== "object") return null;
  const clean = {};
  for (const [k, v] of Object.entries(body)) {
    if (/password|token|secret|csrf/i.test(k)) continue;
    clean[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return JSON.stringify(clean).slice(0, 800);
}

module.exports = { createApp };
