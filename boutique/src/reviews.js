// Customer reviews: submission, purchase verification, moderation and public listing.
//
// Trust rules
// - Every review is stored as "pending"; only "approved" reviews are public.
// - The browser can never set the moderation status or the purchase verification.
// - "Verified Purchase" is set only when a single-use link, e-mailed to the address of a
//   real, paid, shipped/delivered, non-test order containing this product, is used.
//   The "Did you purchase…" answer is stored as the customer's statement, never as proof.
// - Negative reviews are never rejected for being negative: reasons are fixed categories.
const crypto = require("crypto");
const rules = require("../public/js/review-rules.js");
const { catalog } = require("./catalog");
const notify = require("./notify");

const now = () => new Date().toISOString();
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

class ReviewError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; if (errors) this.errors = errors; }
}

const ALLOWED = new Set(["productId", "rating", "displayName", "title", "comment", "purchasedFromHavenLume", "wouldRecommend", "publicationConsent", "verificationToken", "website"]);
const SERVER_ONLY = /^(approved|status|moderation_?status|verified|verified_?purchase|purchase_?verification(_?status)?|purchase_?order_?id|published_?at|created_?at|id|public_?id)$/i;

const STATUSES = ["pending", "approved", "rejected", "hidden"];
// action → allowed previous statuses → new status
const TRANSITIONS = {
  approve: { from: ["pending", "hidden"], to: "approved" },
  reject: { from: ["pending"], to: "rejected" },
  hide: { from: ["approved", "rejected"], to: "hidden" },
  erase: { from: STATUSES, to: "hidden" },
};
// Moderation reasons are content rules, applied the same way to positive and negative reviews.
const REASONS = {
  spam: "Spam or advertising",
  offensive: "Insults, hate or harassment",
  personal_info: "Contains personal information",
  off_topic: "Not about the product or the purchase experience",
  conflict_of_interest: "Written by staff, a competitor or someone paid",
  duplicate: "Duplicate of another review",
  customer_request: "Customer asked for correction or removal",
  other: "Other (explained in the note)",
};
const TOKEN_TTL_DAYS = { verify: 7, request: 30 };
const PER_PAGE = 10;

function productOf(cfg) { return catalog(cfg); }

/** A real order that may back a "Verified Purchase" badge. Partially or fully refunded, test,
 *  unpaid, cancelled, returned or not-yet-shipped orders are excluded. */
function isEligibleOrder(db, cfg, order) {
  if (!order || order.is_test) return false;
  if (order.payment_status !== "paid") return false;
  if (!["shipped", "delivered"].includes(order.fulfillment_status)) return false;
  const sku = productOf(cfg).sku;
  return Boolean(db.prepare("SELECT 1 FROM order_items WHERE order_id=? AND sku=?").get(order.id, sku));
}

const hasReview = (db, orderId) => Boolean(db.prepare("SELECT 1 FROM reviews WHERE purchase_order_id=?").get(orderId));

/** Duplicate key: same product and same comment once case, spacing and punctuation are ignored. */
function fingerprint(productId, comment) {
  return sha256(`${productId}|${comment.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`);
}

function newToken() { return crypto.randomBytes(32).toString("base64url"); }

function findToken(db, raw) {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const t = db.prepare("SELECT * FROM review_tokens WHERE token_hash=?").get(sha256(raw));
  if (!t || t.used_at || t.expires_at <= now()) return null;
  return t;
}

// ---------------------------------------------------------------- submission
function submit(db, cfg, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ReviewError(400, "Invalid request.");
  for (const k of Object.keys(body)) {
    if (SERVER_ONLY.test(k)) throw new ReviewError(400, `"${k}" is decided by HavenLume, not by the form.`);
    if (!ALLOWED.has(k)) throw new ReviewError(400, `Unexpected field "${k}".`);
  }
  if (body.website) throw new ReviewError(400, "Your review could not be accepted."); // honeypot
  const product = productOf(cfg);
  if (body.productId !== product.id) throw new ReviewError(400, "Unknown product.");
  const { errors, value } = rules.validate(body);
  if (Object.keys(errors).length) throw new ReviewError(400, "Please correct the highlighted fields.", errors);

  let token = null;
  if (body.verificationToken !== undefined && body.verificationToken !== null && body.verificationToken !== "") {
    token = findToken(db, body.verificationToken);
    if (!token) throw new ReviewError(400, "This verification link is invalid, expired or already used. You can still submit your review without it.");
  }
  const fp = fingerprint(product.id, value.comment);
  if (db.prepare("SELECT 1 FROM reviews WHERE product_id=? AND fingerprint=? AND erased_at IS NULL").get(product.id, fp)) {
    throw new ReviewError(409, "We've already received this review.");
  }

  let verification = "unverified"; let orderId = null;
  if (token) {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(token.order_id);
    if (hasReview(db, token.order_id)) throw new ReviewError(409, "A review has already been submitted for this order.");
    // The order is re-checked now: a refund or cancellation since the link was sent removes eligibility.
    if (isEligibleOrder(db, cfg, order)) { verification = "verified"; orderId = order.id; } else verification = "ineligible";
  }
  const publicId = crypto.randomBytes(9).toString("base64url");
  db.transaction(() => {
    if (token && db.prepare("UPDATE review_tokens SET used_at=? WHERE id=? AND used_at IS NULL").run(now(), token.id).changes !== 1) {
      throw new ReviewError(409, "This verification link was just used.");
    }
    db.prepare(`INSERT INTO reviews(public_id,product_id,rating,display_name,title,comment,purchased_from_havenlume,would_recommend,
      publication_consent,moderation_status,purchase_verification_status,purchase_order_id,fingerprint,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,1,'pending',?,?,?,?,?)`)
      .run(publicId, product.id, value.rating, value.displayName, value.title, value.comment, value.purchasedFromHavenLume, value.wouldRecommend,
        verification, orderId, fp, now(), now());
  })();
  return { id: publicId, status: "pending", verifiedPurchase: verification === "verified" };
}

// ---------------------------------------------------------------- purchase verification
const ORDER_RE = /^[A-Z0-9-]{6,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENERIC = "If this order is eligible for a verified review, we've sent a single-use link to the email address used for the order. It expires in 7 days.";

function reviewLink(cfg, token) { return `${cfg.publicUrl}/product?review=${token}#write-review`; }

/** Customer asks for a verification link. The answer never reveals whether an order exists. */
async function requestVerification(db, cfg, body) {
  if (!notify.emailConfigured(cfg) || !cfg.publicUrl) {
    throw new ReviewError(503, "Purchase verification by email isn't available yet. You can still submit your review; it will be published without the Verified Purchase badge.");
  }
  const orderNumber = String(body?.orderNumber || "").trim().toUpperCase();
  const email = String(body?.email || "").trim().toLowerCase();
  if (!ORDER_RE.test(orderNumber) || !EMAIL_RE.test(email) || email.length > 254) throw new ReviewError(400, "Enter your order number and the email address used for the order.");
  const order = db.prepare("SELECT * FROM orders WHERE order_number=? AND lower(customer_email)=?").get(orderNumber, email);
  if (!order || !isEligibleOrder(db, cfg, order) || hasReview(db, order.id)) return { message: GENERIC };
  const recent = db.prepare("SELECT COUNT(*) n FROM review_tokens WHERE order_id=? AND created_at > ?").get(order.id, new Date(Date.now() - 86_400_000).toISOString()).n;
  if (recent >= 3) return { message: GENERIC };
  await sendLink(db, cfg, order, "verify");
  return { message: GENERIC };
}

async function sendLink(db, cfg, order, purpose) {
  const raw = newToken();
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS[purpose] * 86_400_000).toISOString();
  db.prepare("INSERT INTO review_tokens(token_hash,order_id,purpose,created_at,expires_at) VALUES(?,?,?,?,?)").run(sha256(raw), order.id, purpose, now(), expires);
  const first = order.customer_name.split(" ")[0];
  const intro = purpose === "verify"
    ? "You asked to leave a verified review of your HavenLume order."
    : "Your HavenLume order was delivered. If you have a moment, we'd value your honest review — positive or negative.";
  const lines = [`Hi ${first},`, "", intro, "", "Use this single-use link to write your review:", "%LINK%", "",
    `The link works once and expires in ${TOKEN_TTL_DAYS[purpose]} days. Your review is checked by a person before it is published, and it shows the Verified Purchase badge because it is linked to your order. We never publish your email address, postal address or order number.`,
    "There is no reward for leaving a review, and a critical review is just as welcome as a positive one.",
    "", `— ${cfg.storeName}`];
  const body = lines.join("\n");
  return notify.sendNow(db, cfg, { orderId: order.id, kind: `review_${purpose}`, to: order.customer_email,
    subject: purpose === "verify" ? `Your ${cfg.storeName} review link` : `How is your ${cfg.storeName} throw?`,
    body: body.replace("%LINK%", reviewLink(cfg, raw)), storedBody: body.replace("%LINK%", "[single-use link — not stored]") });
}

/** Admin: ask a delivered customer for an honest review. Only with a working e-mail provider; never twice. */
async function requestReview(db, cfg, orderId, actor) {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order) throw new ReviewError(404, "Order not found.");
  if (!notify.emailConfigured(cfg) || !cfg.publicUrl) throw new ReviewError(409, "No email provider configured (RESEND_API_KEY, EMAIL_FROM, PUBLIC_URL). Nothing was sent.");
  if (order.fulfillment_status !== "delivered" || !isEligibleOrder(db, cfg, order)) throw new ReviewError(409, "Review requests are only sent for paid, non-refunded orders marked delivered.");
  if (order.review_requested_at) throw new ReviewError(409, "A review request was already sent for this order.");
  if (hasReview(db, order.id)) throw new ReviewError(409, "This customer has already reviewed this order.");
  const email = await sendLink(db, cfg, order, "request");
  const ok = email.status === "sent";
  if (ok) db.prepare("UPDATE orders SET review_requested_at=? WHERE id=?").run(now(), order.id);
  db.prepare("INSERT INTO order_events(order_id,event,details,actor,created_at) VALUES(?,?,?,?,?)")
    .run(order.id, ok ? "review_request_sent" : "review_request_failed", ok ? `Review request sent to ${order.customer_email}` : `Review request failed: ${email.error}`, actor, now());
  if (!ok) throw new ReviewError(502, `The email provider refused the message: ${email.error}. Nothing was sent.`);
  return { sent: true };
}

function tokenStatus(db, raw) { return { valid: Boolean(findToken(db, raw)) }; }

// ---------------------------------------------------------------- public listing
function summary(db, productId) {
  const rows = db.prepare("SELECT rating, COUNT(*) n FROM reviews WHERE product_id=? AND moderation_status='approved' GROUP BY rating").all(productId);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0, sum = 0;
  for (const r of rows) { distribution[r.rating] = r.n; count += r.n; sum += r.rating * r.n; }
  return { count, sum, average: count ? Math.round((sum / count) * 100) / 100 : null, distribution };
}

function publicList(db, cfg, query) {
  const product = productOf(cfg);
  if ((query.productId || product.id) !== product.id) throw new ReviewError(404, "Unknown product.");
  const s = summary(db, product.id);
  const pages = Math.max(1, Math.ceil(s.count / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const rows = db.prepare(`SELECT public_id, rating, title, comment, display_name, would_recommend, purchase_verification_status, published_at
    FROM reviews WHERE product_id=? AND moderation_status='approved' ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(product.id, PER_PAGE, (page - 1) * PER_PAGE);
  return {
    productId: product.id, summary: { count: s.count, average: s.average, distribution: s.distribution }, page, pages, perPage: PER_PAGE,
    reviews: rows.map(r => ({ id: r.public_id, rating: r.rating, title: r.title, comment: r.comment, displayName: r.display_name,
      wouldRecommend: r.would_recommend, verifiedPurchase: r.purchase_verification_status === "verified", publishedAt: r.published_at })),
  };
}

// ---------------------------------------------------------------- moderation
function adminList(db, query) {
  const status = STATUSES.includes(query.status) ? query.status : null;
  const rows = db.prepare(`SELECT r.*, o.order_number FROM reviews r LEFT JOIN orders o ON o.id=r.purchase_order_id
    ${status ? "WHERE r.moderation_status=?" : ""} ORDER BY r.created_at DESC LIMIT 200`).all(...(status ? [status] : []));
  const counts = Object.fromEntries(STATUSES.map(st => [st, 0]));
  for (const c of db.prepare("SELECT moderation_status s, COUNT(*) n FROM reviews GROUP BY moderation_status").all()) counts[c.s] = c.n;
  return { counts, reasons: REASONS, reviews: rows.map(r => ({
    id: r.id, publicId: r.public_id, rating: r.rating, title: r.title, comment: r.comment, displayName: r.display_name,
    purchasedFromHavenLume: r.purchased_from_havenlume, wouldRecommend: r.would_recommend, status: r.moderation_status,
    verification: r.purchase_verification_status, orderNumber: r.order_number || null, moderationReason: r.moderation_reason,
    erased: Boolean(r.erased_at), createdAt: r.created_at, publishedAt: r.published_at,
  })) };
}

function history(db, id) {
  if (!db.prepare("SELECT 1 FROM reviews WHERE id=?").get(id)) throw new ReviewError(404, "Review not found.");
  return db.prepare("SELECT action, previous_status, new_status, note, admin_user, created_at FROM review_moderation_history WHERE review_id=? ORDER BY id DESC").all(id);
}

function moderate(db, id, action, body, actor) {
  const t = TRANSITIONS[action];
  if (!t) throw new ReviewError(400, "Unknown moderation action.");
  const r = db.prepare("SELECT * FROM reviews WHERE id=?").get(id);
  if (!r) throw new ReviewError(404, "Review not found.");
  if (r.erased_at) throw new ReviewError(409, "This review's content was erased; it can't be changed.");
  if (!t.from.includes(r.moderation_status)) throw new ReviewError(409, `Can't ${action} a review that is ${r.moderation_status}.`);
  const reason = body?.reason ? String(body.reason) : "";
  const note = String(body?.note || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  if (action !== "approve") {
    if (!REASONS[reason]) throw new ReviewError(400, "Choose a moderation reason.");
    if (reason === "other" && note.length < 5) throw new ReviewError(400, "Explain the reason in the note.");
  } else if (reason) throw new ReviewError(400, "Approving needs no reason.");
  const ts = now();
  db.transaction(() => {
    if (action === "erase") {
      db.prepare(`UPDATE reviews SET moderation_status='hidden', display_name='Removed', title=NULL,
        comment='This review was removed by HavenLume.', erased_at=?, moderation_reason=?, updated_at=? WHERE id=?`).run(ts, reason, ts, id);
    } else {
      db.prepare(`UPDATE reviews SET moderation_status=?, moderation_reason=?, updated_at=?,
        published_at=CASE WHEN ?='approved' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id=?`)
        .run(t.to, action === "approve" ? null : reason, ts, t.to, ts, id);
    }
    db.prepare("INSERT INTO review_moderation_history(review_id,admin_user,action,previous_status,new_status,note,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, actor, action, r.moderation_status, t.to, [reason && REASONS[reason], note].filter(Boolean).join(" — ") || null, ts);
  })();
  return db.prepare("SELECT moderation_status FROM reviews WHERE id=?").get(id).moderation_status;
}

module.exports = { ReviewError, REASONS, TRANSITIONS, STATUSES, PER_PAGE, submit, requestVerification, requestReview, tokenStatus, publicList, summary, adminList, history, moderate, isEligibleOrder, fingerprint };
