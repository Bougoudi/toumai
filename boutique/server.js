require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const iyzico = require("./iyzico");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const fs = require("fs");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "havenlume.sqlite");
// The directory must exist before SQLite opens the file.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_number TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 customer_phone TEXT,
 address1 TEXT NOT NULL,
 address2 TEXT,
 city TEXT NOT NULL,
 state TEXT NOT NULL,
 postal_code TEXT NOT NULL,
 country TEXT NOT NULL DEFAULT 'United States',
 product_name TEXT NOT NULL,
 variant TEXT NOT NULL,
 quantity INTEGER NOT NULL,
 unit_price REAL NOT NULL,
 supplier_unit_cost REAL NOT NULL,
 supplier_shipping REAL NOT NULL,
 customer_total REAL NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'pending',
 fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
 supplier_reference TEXT,
 supplier_ordered_at TEXT,
 actual_product_cost REAL,
 actual_shipping_cost REAL,
 carrier TEXT,
 tracking_number TEXT,
 tracking_url TEXT,
 shipped_at TEXT,
 delivered_at TEXT,
 notes TEXT
);
CREATE TABLE IF NOT EXISTS order_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 event TEXT NOT NULL,
 details TEXT,
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);
// Lightweight migrations for databases created before iyzico checkout existed.
{
  const cols = new Set(db.prepare("PRAGMA table_info(orders)").all().map(c => c.name));
  const add = (name, def) => { if (!cols.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${def}`); };
  add("currency", "TEXT NOT NULL DEFAULT 'USD'");
  add("iyzico_token", "TEXT");
  add("iyzico_payment_id", "TEXT");
  add("paid_at", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS orders_iyzico_token ON orders(iyzico_token)");
}
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
// admin.html must only be served through the authenticated /admin route.
app.use((req,res,next) => /^\/admin\.html$/i.test(req.path) ? res.redirect("/admin") : next());
// Basic CSRF defence for state-changing requests: reject cross-origin browser POSTs
// (in addition to the SameSite=Strict admin cookie).
app.use((req,res,next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  // iyzico's payment page posts the customer's browser back here; the token it carries
  // is verified server-side against iyzico's API, so this route is safe cross-origin.
  if (req.path === "/api/checkout/iyzico/callback") return next();
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.headers.host}` && origin !== process.env.PUBLIC_URL) {
    return res.status(403).json({error:"Cross-origin request rejected."});
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

const price = () => Number(process.env.STORE_PRICE_USD || 74.99);
const supplierCost = () => Number(process.env.SUPPLIER_PRODUCT_COST_USD || 27.24);
const supplierShipping = () => Number(process.env.SUPPLIER_SHIPPING_COST_USD || 15);
const now = () => new Date().toISOString();
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const adminSessions = new Map(); // In-memory: sessions are lost on restart (see README).
setInterval(() => { const t = Date.now(); for (const [k,v] of adminSessions) if (v.expires < t) adminSessions.delete(k); }, 15*60_000).unref();
const safeEqual = (a,b) => {
  const aa = Buffer.from(String(a || "")); const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const i=x.indexOf("="); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))];
  }));
}
function requireAdmin(req,res,next) {
  const token = parseCookies(req).hl_admin;
  const session = token && adminSessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (req.path.startsWith("/api/")) return res.status(401).json({error:"Administrator authentication required."});
    return res.redirect("/admin-login.html");
  }
  req.adminSession = session; next();
}
function event(orderId, name, details="") {
  db.prepare("INSERT INTO order_events(order_id,event,details,created_at) VALUES(?,?,?,?)").run(orderId,name,details,now());
}
function orderView(row) {
  const baseCost = (row.actual_product_cost ?? row.supplier_unit_cost * row.quantity) + (row.actual_shipping_cost ?? row.supplier_shipping * row.quantity);
  const paymentFees = 0; // Replace with actual provider fee once known.
  const profit = row.customer_total - baseCost - paymentFees;
  return {...row, base_cost: baseCost, estimated_profit: profit, estimated_margin: row.customer_total > 0 ? profit / row.customer_total * 100 : 0};
}
const currency = () => String(process.env.STORE_CURRENCY || "USD").toUpperCase();
const VARIANTS = ["Camel Brown", "Pearl White"];
app.get("/api/config", (_req,res) => res.json({
 price: price(), currency: currency(), checkoutEnabled: iyzico.checkoutStatus().enabled, checkoutSandbox: Boolean(iyzico.checkoutStatus().sandbox),
 livePaymentsEnabled: process.env.LIVE_PAYMENTS_ENABLED === "true",
 productComplianceVerified: process.env.PRODUCT_COMPLIANCE_VERIFIED === "true",
 deliveryMinDays: Number(process.env.SUPPLIER_MIN_DELIVERY_DAYS || 2),
 deliveryMaxDays: Number(process.env.SUPPLIER_MAX_DELIVERY_DAYS || 8)
}));

// This starter deliberately does not collect money or pretend to verify payment.
// Orders created here are clearly marked TEST / UNPAID and cannot be fulfilled as paid orders.
// Validates the customer form; returns an error message or null.
function validateOrderInput(b) {
  const required = ["name","email","address1","city","state","postalCode","variant"];
  for (const k of required) if (!String(b[k] || "").trim()) return `Missing field: ${k}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return "Enter a valid email address.";
  if (!VARIANTS.includes(String(b.variant))) return "Unknown colour.";
  return null;
}
// Inserts an order; the price is always computed server-side.
function insertOrder(b, orderNumber, paymentStatus) {
  const qty = Math.max(1, Math.min(5, Number.parseInt(b.quantity,10) || 1));
  const total = Number((price()*qty).toFixed(2));
  const result = db.prepare(`INSERT INTO orders
  (order_number,created_at,customer_name,customer_email,customer_phone,address1,address2,city,state,postal_code,country,product_name,variant,quantity,unit_price,supplier_unit_cost,supplier_shipping,customer_total,payment_status,fulfillment_status,currency)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    orderNumber,now(),String(b.name).trim().slice(0,120),String(b.email).trim().slice(0,254),String(b.phone||"").trim().slice(0,40),
    String(b.address1).trim().slice(0,200),String(b.address2||"").trim().slice(0,200),String(b.city).trim().slice(0,100),
    String(b.state).trim().slice(0,100),String(b.postalCode).trim().slice(0,20),String(b.country||"United States").trim().slice(0,80),
    "USB Heated Wearable Throw",String(b.variant),qty,price(),supplierCost(),supplierShipping(),total,paymentStatus,"unfulfilled",currency()
  );
  return db.prepare("SELECT * FROM orders WHERE id=?").get(result.lastInsertRowid);
}

// Demo orders never collect money and cannot be fulfilled.
app.post("/api/demo-order", rateLimit({windowMs: 60_000, limit: 5}), (req,res) => {
  const b = req.body || {};
  const invalid = validateOrderInput(b); if (invalid) return res.status(400).json({error: invalid});
  const order = insertOrder(b, "HL-TEST-" + crypto.randomBytes(4).toString("hex").toUpperCase(), "test_unpaid");
  event(order.id,"demo_order_created","Test order only; no payment was collected.");
  res.status(201).json({orderNumber: order.order_number, paymentStatus:"test_unpaid", message:"Demo order created. No payment was collected; do not ship this order."});
});

// Real checkout through iyzico's hosted payment page.
app.post("/api/checkout", rateLimit({windowMs: 60_000, limit: 5}), async (req,res) => {
  const status = iyzico.checkoutStatus();
  if (!status.enabled) return res.status(503).json({error: "Online payment is not available yet."});
  const b = req.body || {};
  const invalid = validateOrderInput(b); if (invalid) return res.status(400).json({error: invalid});
  const order = insertOrder(b, "HL-" + crypto.randomBytes(5).toString("hex").toUpperCase(), "pending");
  try {
    const { token, paymentPageUrl } = await iyzico.initializeCheckout(order, req.ip);
    db.prepare("UPDATE orders SET iyzico_token=? WHERE id=?").run(token, order.id);
    event(order.id, "checkout_started", status.sandbox ? "iyzico SANDBOX checkout created." : "iyzico checkout created.");
    res.status(201).json({orderNumber: order.order_number, paymentPageUrl});
  } catch (err) {
    db.prepare("UPDATE orders SET payment_status='failed' WHERE id=?").run(order.id);
    event(order.id, "checkout_failed", String(err.message || err).slice(0,500));
    console.error("iyzico initialize failed:", err.message || err);
    res.status(502).json({error: "Could not open the payment page. Please try again later."});
  }
});

// Asks iyzico for the payment behind the order's token and records it if verified.
// Idempotent: a repeated callback or admin re-check never double-processes.
async function confirmPayment(order) {
  if (!order.iyzico_token) return { paid: false, reason: "No iyzico checkout for this order." };
  if (order.payment_status === "paid") return { paid: true, already: true };
  const verdict = iyzico.verifyPayment(await iyzico.retrieveCheckout(order.iyzico_token), order);
  if (verdict.paid) {
    const changed = db.prepare("UPDATE orders SET payment_status='paid', iyzico_payment_id=?, paid_at=? WHERE id=? AND payment_status<>'paid'")
      .run(verdict.paymentId, now(), order.id).changes;
    if (changed) event(order.id, "payment_verified", `iyzico payment ${verdict.paymentId}`);
  } else if (order.payment_status === "pending") {
    event(order.id, "payment_not_verified", verdict.reason);
  }
  return verdict;
}

app.post("/api/checkout/iyzico/callback", async (req,res) => {
  const token = String(req.body?.token || "").slice(0, 200);
  const order = token && db.prepare("SELECT * FROM orders WHERE iyzico_token=?").get(token);
  if (!order) return res.redirect(303, "/order-status.html?result=unknown");
  try {
    const verdict = await confirmPayment(order);
    res.redirect(303, `/order-status.html?order=${encodeURIComponent(order.order_number)}&result=${verdict.paid ? "paid" : "failed"}`);
  } catch (err) {
    console.error("iyzico retrieve failed:", err.message || err);
    res.redirect(303, `/order-status.html?order=${encodeURIComponent(order.order_number)}&result=pending`);
  }
});

// Public status lookup by order number (no personal data returned).
app.get("/api/orders/:orderNumber/status", (req,res) => {
  const row = db.prepare("SELECT order_number,payment_status,fulfillment_status,customer_total,currency FROM orders WHERE order_number=?").get(String(req.params.orderNumber).slice(0,40));
  if (!row) return res.status(404).json({error:"Order not found."});
  res.json(row);
});

app.get("/admin", requireAdmin, (_req,res) => res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/api/admin/orders", requireAdmin, (_req,res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 250").all();
  res.json(rows.map(orderView));
});
app.get("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({error:"Order not found."});
  const events = db.prepare("SELECT event,details,created_at FROM order_events WHERE order_id=? ORDER BY id DESC").all(row.id);
  res.json({...orderView(row),events});
});
app.post("/api/admin/orders/:id/supplier-order", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if (!row) return res.status(404).json({error:"Order not found."});
  if (row.payment_status !== "paid") return res.status(409).json({error:"Only genuinely paid orders may be marked as sent to the supplier. This starter's demo orders are unpaid."});
  const reference = String(req.body.reference || "").trim().slice(0,100);
  const cost = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  db.prepare("UPDATE orders SET fulfillment_status='supplier_ordered', supplier_reference=?, supplier_ordered_at=?, actual_product_cost=COALESCE(?,actual_product_cost), actual_shipping_cost=COALESCE(?,actual_shipping_cost) WHERE id=?")
    .run(reference,now(),cost(req.body.actualProductCost),cost(req.body.actualShippingCost),id);
  event(id,"supplier_ordered",reference);
  res.json({ok:true});
});
app.post("/api/admin/orders/:id/tracking", requireAdmin, (req,res) => {
  const id=Number(req.params.id); const row=db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if(!row) return res.status(404).json({error:"Order not found."});
  if(row.payment_status!=="paid") return res.status(409).json({error:"Cannot mark an unpaid/test order as shipped."});
  const carrier=String(req.body.carrier||"").trim().slice(0,80);
  const number=String(req.body.trackingNumber||"").trim().slice(0,120);
  const url=String(req.body.trackingUrl||"").trim().slice(0,500);
  if(!number) return res.status(400).json({error:"Tracking number is required."});
  if(url && !/^https:\/\/\S+/i.test(url)) return res.status(400).json({error:"Tracking URL must use HTTPS."});
  db.prepare("UPDATE orders SET fulfillment_status='shipped',carrier=?,tracking_number=?,tracking_url=?,shipped_at=? WHERE id=?").run(carrier,number,url,now(),id);
  event(id,"shipped",`${carrier} ${number}`);
  res.json({ok:true});
});
app.post("/api/admin/orders/:id/verify-payment", requireAdmin, async (req,res) => {
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({error:"Order not found."});
  try {
    const verdict = await confirmPayment(row);
    res.status(verdict.paid ? 200 : 409).json(verdict.paid ? {ok:true} : {error: `Not paid: ${verdict.reason}`});
  } catch (err) {
    res.status(502).json({error: `iyzico lookup failed: ${err.message || err}`});
  }
});
app.post("/api/admin/orders/:id/notes", requireAdmin, (req,res) => {
  const id=Number(req.params.id); const row=db.prepare("SELECT id FROM orders WHERE id=?").get(id);
  if(!row) return res.status(404).json({error:"Order not found."});
  const notes=String(req.body.notes||"").slice(0,2000);
  db.prepare("UPDATE orders SET notes=? WHERE id=?").run(notes,id); event(id,"notes_updated","Admin note updated.");
  res.json({ok:true});
});
app.post("/api/admin/login", rateLimit({windowMs:15*60_000,limit:10}), (req,res) => {
  const username=String(req.body.username||"");
  const password=String(req.body.password||"");
  const expectedUser=process.env.ADMIN_USERNAME || "admin";
  const hash=process.env.ADMIN_PASSWORD_HASH || "";
  if(!hash) return res.status(503).json({error:"Admin password hash is not configured. Follow README setup instructions."});
  const [scheme,salt,stored]=hash.split("$");
  let valid=false;
  if(scheme==="scrypt" && salt && stored) {
    const derived=crypto.scryptSync(password,salt,64).toString("hex");
    valid=safeEqual(derived,stored);
  }
  if(!safeEqual(username,expectedUser)||!valid) return res.status(401).json({error:"Invalid credentials."});
  const token=crypto.randomBytes(32).toString("hex");
  adminSessions.set(token,{expires:Date.now()+8*60*60*1000});
  res.setHeader("Set-Cookie",`hl_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==="production"?"; Secure":""}`);
  res.json({ok:true});
});
app.post("/api/admin/logout", requireAdmin, (req,res) => {
  const token=parseCookies(req).hl_admin; if(token) adminSessions.delete(token);
  res.setHeader("Set-Cookie","hl_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ok:true});
});
app.get("/admin-login.html", (_req,res) => res.sendFile(path.join(__dirname,"public","admin-login.html")));
app.get("/health", (_req,res) => res.json({ok:true}));

app.listen(PORT, () => { const s = iyzico.checkoutStatus(); console.log(`HavenLume running on port ${PORT}. Checkout: ${s.enabled ? (s.sandbox ? "iyzico SANDBOX" : "iyzico LIVE") : "disabled (" + s.reason + ")"}`); });
