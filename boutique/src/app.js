// HTTP layer. Business rules live in orders.js; this file wires routes, security and auth.
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { catalog } = require("./catalog");
const { getSettings, DEFAULT_SETTINGS } = require("./db");
const { dashboard, orderProfit, referenceUnitCostCents } = require("./profit");
const iyzico = require("./iyzico");
const notify = require("./notify");
const auth = require("./auth");
const orders = require("./orders");
const backup = require("./backup");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Signs order-status links. Without STATUS_LINK_SECRET a per-process secret is used,
// so old links only lose the item/tracking details after a restart.
const STATUS_SECRET = process.env.STATUS_LINK_SECRET || crypto.randomBytes(32).toString("hex");
const statusKey = (orderNumber) => crypto.createHmac("sha256", STATUS_SECRET).update(orderNumber).digest("hex").slice(0, 32);

function createApp({ cfg, db, log = console }) {
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https://images.unsplash.com"],
        "connect-src": ["'self'"],
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
    });
  });

  app.get("/api/catalog", (_req, res) => {
    const p = catalog(cfg);
    res.json({ id: p.id, name: p.name, priceCents: p.priceCents, maxQtyPerLine: p.maxQtyPerLine, images: p.images,
      variants: p.variants.map(v => ({ id: v.id, name: v.name, available: v.available, swatch: v.swatch })), states: orders.US_STATES });
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
    });
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
      fulfillment_status: o.fulfillment_status, tracking_number: o.tracking_number, profit: orderProfit(o),
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
  app.post("/api/admin/orders/:id/notes", requireAdmin, adminAction("notes_updated", (req, res) => {
    const id = orderId(req);
    if (!orders.getOrder(db, id)) return res.status(404).json({ error: "Order not found." });
    db.prepare("UPDATE orders SET notes=?, updated_at=? WHERE id=?").run(String(req.body?.notes || "").slice(0, 4000), new Date().toISOString(), id);
    res.json({ ok: true });
  }));

  app.post("/api/admin/emails/:emailId/send", requireAdmin, wrap(async (req, res) => {
    if (!notify.emailConfigured(cfg)) return res.status(409).json({ error: "No email provider configured (RESEND_API_KEY, EMAIL_FROM). Copy the email and send it yourself." });
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
    if (err instanceof orders.OrderError) return res.status(err.status).json({ error: err.message });
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
