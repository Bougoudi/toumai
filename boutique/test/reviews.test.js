// Customer reviews: submission, validation, anti-abuse, moderation, purchase verification,
// public display rules and the v6 migration. Isolated temporary databases only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const notify = require("../src/notify");
const { open, rollbackReviews } = require("../src/db");
const rules = require("../public/js/review-rules.js");
const { startStore, paidOrder, completeChecklist } = require("./helpers");

const VALID = { productId: "usb-heated-throw", rating: 4, displayName: "Dana R.", title: "Warm enough at my desk",
  comment: "I use it in my home office in the afternoons. Soft fabric, the cable is a bit short for my setup.",
  purchasedFromHavenLume: "yes", wouldRecommend: "yes", publicationConsent: true };
const review = (over = {}) => ({ ...VALID, ...over });
const many = { REVIEW_SUBMIT_LIMIT: "100", REVIEW_VERIFY_LIMIT: "100" };
const count = (s, where = "1=1") => s.db.prepare(`SELECT COUNT(*) n FROM reviews WHERE ${where}`).get().n;

/** Fake e-mail provider: records what would have been sent. */
function fakeMail() {
  const sent = [];
  notify.setFetchForTests(async (url, opts) => {
    if (String(url).startsWith("https://api.resend.com")) { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: `em_${sent.length}` }) }; }
    return { ok: true, json: async () => ({}) };
  });
  return sent;
}
const tokenFrom = (mail) => (mail.text.match(/[?&]review=([A-Za-z0-9_-]{43})/) || [])[1];

/** A paid order moved to shipped (or delivered) through the real admin API. */
async function shippedOrder(s, h, { delivered = false } = {}) {
  const o = await paidOrder(s);
  await completeChecklist(s, h, o.id);
  assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/supplier-order`, { supplierReference: `AE-${o.id}` }, h)).status, 200);
  assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/shipment`, { carrier: "USPS", trackingNumber: `94001${o.id}` }, h)).status, 200);
  if (delivered) assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/status`, { status: "delivered" }, h)).status, 200);
  return s.db.prepare("SELECT * FROM orders WHERE id=?").get(o.id);
}

// ---------------------------------------------------------------- shared rules
test("R1. shared rules: demo initial state is invalid until name, comment and consent are given", () => {
  assert.deepEqual(rules.INITIAL, { rating: 5, displayName: "", title: "", comment: "", purchasedFromHavenLume: "yes", wouldRecommend: "yes", publicationConsent: false });
  assert.deepEqual(Object.keys(rules.validate(rules.INITIAL).errors).sort(), ["comment", "displayName", "publicationConsent"]);
  assert.deepEqual(rules.validate(review()).errors, {});
  assert.equal(rules.normalize("  Dana \t  R.  ", false), "Dana R.");
  assert.equal(rules.length(rules.normalize("   " + "a".repeat(19) + "   ", true)), 19, "spaces don't count toward the minimum");
  assert.ok(rules.validate(review({ comment: "  " + "a".repeat(19) + "  " })).errors.comment);
  assert.equal(rules.length("😀".repeat(40)), 40, "emoji count as one character");
});

// ---------------------------------------------------------------- submission & validation
test("R2. a valid review is stored as pending, unverified, and is not public before moderation", async () => {
  const s = await startStore(many);
  try {
    const r = await s.req("POST", "/api/reviews", review());
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(Object.keys(r.json).sort(), ["id", "status", "verifiedPurchase"]);
    assert.equal(r.json.status, "pending"); assert.equal(r.json.verifiedPurchase, false);
    const row = s.db.prepare("SELECT * FROM reviews").get();
    assert.equal(row.moderation_status, "pending"); assert.equal(row.purchase_verification_status, "unverified");
    assert.equal(row.purchase_order_id, null); assert.equal(row.purchased_from_havenlume, "yes", "stored as a statement only");
    const pub = (await s.req("GET", "/api/reviews?productId=usb-heated-throw")).json;
    assert.deepEqual(pub.summary, { count: 0, average: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    assert.deepEqual(pub.reviews, []);
    assert.equal((await s.req("GET", "/api/reviews?productId=other")).status, 404);
  } finally { s.close(); }
});

test("R3. invalid ratings, missing fields, length limits and consent are refused by the server", async () => {
  const s = await startStore(many);
  try {
    const bad = [
      ...[0, 6, 4.5, "5", null, -1, true].map(rating => [{ rating }, "rating"]),
      [{ rating: undefined }, "rating"],
      [{ displayName: undefined }, "displayName"], [{ displayName: "A" }, "displayName"], [{ displayName: " A " }, "displayName"], [{ displayName: "x".repeat(41) }, "displayName"],
      [{ title: "t".repeat(101) }, "title"],
      [{ comment: undefined }, "comment"], [{ comment: "" }, "comment"], [{ comment: "Too short review." }, "comment"],
      [{ comment: "   " + "a".repeat(19) + "     " }, "comment"], [{ comment: "a".repeat(1501) }, "comment"],
      [{ purchasedFromHavenLume: undefined }, "purchasedFromHavenLume"], [{ purchasedFromHavenLume: "maybe" }, "purchasedFromHavenLume"],
      [{ wouldRecommend: "definitely" }, "wouldRecommend"],
      [{ publicationConsent: false }, "publicationConsent"], [{ publicationConsent: "true" }, "publicationConsent"], [{ publicationConsent: undefined }, "publicationConsent"],
    ];
    for (const [over, field] of bad) {
      const r = await s.req("POST", "/api/reviews", review(over));
      assert.equal(r.status, 400, JSON.stringify(over)); assert.ok(r.json.errors && r.json.errors[field], `${JSON.stringify(over)} → ${r.text}`);
    }
    // Boundaries that must pass
    for (const [i, over] of [{ displayName: "Al" }, { displayName: "x".repeat(40) }, { title: "t".repeat(100) }, { comment: "a".repeat(20) + " ok" }, { comment: "b".repeat(1500) }, { wouldRecommend: "not_sure_yet" }, { wouldRecommend: null }, { rating: 1 }].entries()) {
      const r = await s.req("POST", "/api/reviews", review({ comment: `${VALID.comment} Case ${i}.`, ...over }));
      assert.equal(r.status, 201, `${JSON.stringify(over).slice(0, 60)} → ${r.text}`);
    }
    for (const body of ["not json", "[]", "null"]) assert.equal((await s.req("POST", "/api/reviews", body)).status, 400, body);
    assert.equal((await s.req("POST", "/api/reviews", review({ productId: "something-else" }))).status, 400);
    assert.equal((await s.req("POST", "/api/reviews", JSON.stringify(review({ comment: "c".repeat(40000) })))).status, 413, "body size limit");
    assert.equal(count(s), 8, "only the valid boundary cases were stored");
  } finally { s.close(); }
});

test("R4. the browser can't set status or verification; unknown fields and the honeypot are refused", async () => {
  const s = await startStore(many);
  try {
    for (const k of ["approved", "status", "moderationStatus", "moderation_status", "verifiedPurchase", "verified", "purchaseVerificationStatus", "purchase_order_id", "publishedAt", "id"]) {
      const r = await s.req("POST", "/api/reviews", review({ [k]: k === "status" || /moderation/i.test(k) ? "approved" : true }));
      assert.equal(r.status, 400, k); assert.match(r.json.error, /decided by HavenLume/);
    }
    assert.equal((await s.req("POST", "/api/reviews", review({ orderNumber: "HL-123" }))).status, 400, "unknown field");
    assert.equal((await s.req("POST", "/api/reviews", review({ website: "http://spam.example" }))).status, 400, "honeypot");
    const fakeToken = await s.req("POST", "/api/reviews", review({ verificationToken: "a".repeat(43) }));
    assert.equal(fakeToken.status, 400, "a token the server didn't issue is refused"); assert.match(fakeToken.json.error, /invalid, expired or already used/);
    assert.equal(count(s), 0);
  } finally { s.close(); }
});

test("R5. HTML and JavaScript are stored as plain text and never interpreted by the API", async () => {
  const s = await startStore(many);
  try {
    const h = await s.login();
    const payload = review({ displayName: "<img src=x onerror=alert(1)>", title: "<script>alert('t')</script>", comment: "<b>bold</b> <script>alert(document.cookie)</script> and a long enough text" });
    const r = await s.req("POST", "/api/reviews", payload);
    assert.equal(r.status, 201);
    const id = s.db.prepare("SELECT id FROM reviews").get().id;
    await s.req("POST", `/api/admin/reviews/${id}/approve`, {}, h);
    const pub = await s.req("GET", "/api/reviews");
    assert.match(pub.headers.get("content-type"), /application\/json/);
    assert.equal(pub.json.reviews[0].comment, "<b>bold</b> <script>alert(document.cookie)</script> and a long enough text", "returned verbatim as JSON text");
    // The product page renders with textContent only, and the CSP forbids inline scripts.
    const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "reviews.js"), "utf8");
    assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    assert.match((await s.req("GET", "/product")).headers.get("content-security-policy"), /script-src 'self'/);
  } finally { s.close(); }
});

test("R6. duplicates are refused (409) and submissions are rate limited (429)", async () => {
  const s = await startStore(many);
  try {
    assert.equal((await s.req("POST", "/api/reviews", review())).status, 201);
    const dup = await s.req("POST", "/api/reviews", review({ displayName: "Someone Else", rating: 1, comment: VALID.comment.toUpperCase().replace(/\./g, "!!") + "  " }));
    assert.equal(dup.status, 409, "same text, different case/punctuation/rating");
    assert.equal(count(s), 1);
  } finally { s.close(); }
  const limited = await startStore(); // default: 5 per 15 minutes per IP
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await limited.req("POST", "/api/reviews", review({ comment: `${VALID.comment} Variation number ${i}.` }))).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
  } finally { limited.close(); }
});

test("R7. a negative review is accepted, approved and published like any other", async () => {
  const s = await startStore(many);
  try {
    const h = await s.login();
    const r = await s.req("POST", "/api/reviews", review({ rating: 1, title: "Not for me", comment: "It never felt warm enough for me and the power bank I own was not compatible.", wouldRecommend: "no" }));
    assert.equal(r.status, 201);
    const id = s.db.prepare("SELECT id FROM reviews").get().id;
    const rej = await s.req("POST", `/api/admin/reviews/${id}/reject`, { reason: "negative" }, h);
    assert.equal(rej.status, 400, "'negative' is not a moderation reason");
    assert.equal((await s.req("POST", `/api/admin/reviews/${id}/approve`, {}, h)).status, 200);
    const pub = (await s.req("GET", "/api/reviews")).json;
    assert.equal(pub.summary.count, 1); assert.equal(pub.reviews[0].rating, 1); assert.equal(pub.summary.average, 1);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- moderation
test("R8. admin review routes refuse unauthenticated, forged, CSRF-less and cross-origin requests", async () => {
  const s = await startStore(many);
  try {
    await s.req("POST", "/api/reviews", review());
    const id = s.db.prepare("SELECT id FROM reviews").get().id;
    const routes = [["GET", "/api/admin/reviews?status=pending"], ["GET", `/api/admin/reviews/${id}/moderation-history`],
      ...["approve", "reject", "hide", "erase"].map(a => ["POST", `/api/admin/reviews/${id}/${a}`]), ["POST", "/api/admin/orders/1/review-request"]];
    for (const [m, p] of routes) {
      assert.equal((await s.req(m, p, m === "POST" ? { reason: "spam" } : undefined)).status, 401, `${m} ${p}`);
      assert.equal((await s.req(m, p, m === "POST" ? {} : undefined, { Cookie: "hl_admin=" + "f".repeat(64) })).status, 401, `forged ${p}`);
    }
    const h = await s.login();
    assert.equal((await s.req("POST", `/api/admin/reviews/${id}/approve`, {}, { Cookie: h.Cookie })).status, 403, "CSRF token required");
    assert.equal((await s.req("POST", `/api/admin/reviews/${id}/approve`, {}, { ...h, Origin: "https://evil.example" })).status, 403);
    assert.equal((await s.req("POST", `/api/admin/reviews/${id}/approve`, {}, { Cookie: h.Cookie, "X-Admin-Role": "admin" })).status, 403, "a role header is ignored");
    assert.equal(s.db.prepare("SELECT moderation_status FROM reviews").get().moderation_status, "pending");
  } finally { s.close(); }
});

test("R9. transitions are controlled, reasons are required, and each change writes one history entry", async () => {
  const s = await startStore(many);
  try {
    const h = await s.login();
    for (let i = 0; i < 3; i++) await s.req("POST", "/api/reviews", review({ comment: `${VALID.comment} Review ${i}.` }));
    const [a, b, c] = s.db.prepare("SELECT id FROM reviews ORDER BY id").all().map(r => r.id);
    const act = (id, action, body = {}) => s.req("POST", `/api/admin/reviews/${id}/${action}`, body, h);
    const status = id => s.db.prepare("SELECT moderation_status s FROM reviews WHERE id=?").get(id).s;
    const hist = id => s.db.prepare("SELECT COUNT(*) n FROM review_moderation_history WHERE review_id=?").get(id).n;

    assert.equal((await act(a, "hide", { reason: "spam" })).status, 409, "pending can't be hidden"); assert.equal(status(a), "pending"); assert.equal(hist(a), 0);
    assert.equal((await act(a, "reject")).status, 400, "reason required");
    assert.equal((await act(a, "reject", { reason: "other" })).status, 400, "'other' needs a note");
    assert.equal((await act(a, "approve", { reason: "spam" })).status, 400, "approve takes no reason");
    assert.equal((await act(a, "publish")).status, 404);
    assert.equal((await act(9999, "approve")).status, 404);

    assert.equal((await act(a, "approve")).status, 200); assert.equal(status(a), "approved"); assert.equal(hist(a), 1);
    const publishedAt = s.db.prepare("SELECT published_at p FROM reviews WHERE id=?").get(a).p; assert.ok(publishedAt);
    assert.equal((await act(a, "approve")).status, 409, "already approved");
    assert.equal((await act(a, "hide", { reason: "off_topic" })).status, 200); assert.equal(status(a), "hidden");
    assert.equal((await act(a, "approve")).status, 200, "hidden → approved"); assert.equal(hist(a), 3);
    assert.equal(s.db.prepare("SELECT published_at p FROM reviews WHERE id=?").get(a).p, publishedAt, "original publication date kept");

    assert.equal((await act(b, "reject", { reason: "personal_info" })).status, 200); assert.equal(status(b), "rejected");
    assert.equal((await act(b, "approve")).status, 409, "rejected can't be approved directly");
    assert.equal((await act(b, "hide", { reason: "duplicate" })).status, 200);

    assert.equal((await act(c, "erase", { reason: "customer_request", note: "Asked by email" })).status, 200);
    const erased = s.db.prepare("SELECT * FROM reviews WHERE id=?").get(c);
    assert.equal(erased.moderation_status, "hidden"); assert.ok(erased.erased_at); assert.equal(erased.display_name, "Removed");
    assert.doesNotMatch(erased.comment, /home office/); assert.equal((await act(c, "approve")).status, 409, "erased content can't come back");

    const h2 = (await s.req("GET", `/api/admin/reviews/${a}/moderation-history`, undefined, h)).json;
    assert.deepEqual(h2.map(x => [x.action, x.previous_status, x.new_status]), [["approve", "hidden", "approved"], ["hide", "approved", "hidden"], ["approve", "pending", "approved"]]);
    assert.ok(h2.every(x => x.admin_user === "owner"));
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'review_%'").get().n, 6, "one audit entry per successful action");
    const list = (await s.req("GET", "/api/admin/reviews?status=hidden", undefined, h)).json;
    assert.deepEqual(list.reviews.map(r => r.id).sort(), [b, c].sort()); assert.equal(list.counts.approved, 1);
    // No route edits text, rating or verification
    for (const p of [`/api/admin/reviews/${a}`, `/api/admin/reviews/${a}/edit`, `/api/admin/reviews/${a}/verify`]) assert.equal((await s.req("POST", p, { rating: 5 }, h)).status, 404, p);
  } finally { s.close(); }
});

// ---------------------------------------------------------------- public display
test("R10. average, count and distribution come only from approved reviews; pagination; no private data", async () => {
  const s = await startStore(many);
  try {
    const h = await s.login();
    const ratings = [5, 4, 1, 5, 2, 3, 5, 4, 4, 1, 5, 3]; // 12 approved
    for (const [i, rating] of ratings.entries()) await s.req("POST", "/api/reviews", review({ rating, comment: `${VALID.comment} Number ${i}.` }));
    for (const r of s.db.prepare("SELECT id FROM reviews").all()) await s.req("POST", `/api/admin/reviews/${r.id}/approve`, {}, h);
    // pending and rejected reviews never count
    await s.req("POST", "/api/reviews", review({ rating: 1, comment: `${VALID.comment} Pending one.` }));
    await s.req("POST", "/api/reviews", review({ rating: 1, comment: `${VALID.comment} Rejected one.` }));
    const rej = s.db.prepare("SELECT id FROM reviews ORDER BY id DESC").get().id;
    await s.req("POST", `/api/admin/reviews/${rej}/reject`, { reason: "spam" }, h);

    const p1 = (await s.req("GET", "/api/reviews?page=1")).json;
    const sum = ratings.reduce((a, b) => a + b, 0);
    assert.equal(p1.summary.count, 12);
    assert.equal(p1.summary.average, Math.round((sum / 12) * 100) / 100); assert.equal(p1.summary.average, 3.5);
    assert.deepEqual(p1.summary.distribution, { 1: 2, 2: 1, 3: 2, 4: 3, 5: 4 });
    assert.equal(p1.reviews.length, 10); assert.equal(p1.pages, 2);
    const p2 = (await s.req("GET", "/api/reviews?page=2")).json;
    assert.equal(p2.reviews.length, 2); assert.equal((await s.req("GET", "/api/reviews?page=99")).json.page, 2);
    const ids = new Set([...p1.reviews, ...p2.reviews].map(r => r.id)); assert.equal(ids.size, 12);
    assert.deepEqual(Object.keys(p1.reviews[0]).sort(), ["comment", "displayName", "id", "publishedAt", "rating", "title", "verifiedPurchase", "wouldRecommend"]);
    const raw = JSON.stringify(p1) + JSON.stringify(p2);
    for (const secret of ["purchased_from", "purchasedFromHavenLume", "fingerprint", "order", "email", "moderation", "@"]) assert.equal(raw.includes(secret), false, secret);
  } finally { s.close(); }
});

test("R11. loading the page or the review list never writes to the database", async () => {
  const s = await startStore(many);
  try {
    const before = s.db.prepare("SELECT (SELECT COUNT(*) FROM reviews) r, (SELECT COUNT(*) FROM review_tokens) t, (SELECT COUNT(*) FROM orders) o").get();
    for (const p of ["/product", "/api/reviews", "/api/reviews?page=2", "/review-policy", "/api/reviews/verification?token=" + "b".repeat(43)]) assert.equal((await s.req("GET", p)).status, 200, p);
    const after = s.db.prepare("SELECT (SELECT COUNT(*) FROM reviews) r, (SELECT COUNT(*) FROM review_tokens) t, (SELECT COUNT(*) FROM orders) o").get();
    assert.deepEqual(after, before); assert.deepEqual(after, { r: 0, t: 0, o: 0 }, "no demo reviews or orders are seeded");
  } finally { s.close(); }
});

// ---------------------------------------------------------------- purchase verification
test("R12. Verified Purchase only through the e-mailed single-use link for an eligible order", async () => {
  const sent = fakeMail();
  const s = await startStore({ ...many, RESEND_API_KEY: "re_test", EMAIL_FROM: "HavenLume <shop@example.com>" });
  try {
    const h = await s.login();
    const ask = (o, email = "jane@example.com") => s.req("POST", "/api/reviews/verification-request", { orderNumber: o.order_number, email });
    const reviewMails = () => sent.filter(m => /review link/.test(m.subject));

    // Not eligible: unpaid, paid but not shipped, test order, unknown order, wrong email → same answer, nothing sent
    const unpaid = s.db.prepare("SELECT * FROM orders WHERE id=?").get((await s.req("POST", "/api/checkout", { customer: { name: "Jane Doe", email: "jane@example.com", address1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" }, items: [{ variantId: "camel-brown", quantity: 1 }] })).json && s.db.prepare("SELECT id FROM orders ORDER BY id DESC").get().id);
    const notShipped = await paidOrder(s);
    const testOrder = await shippedOrder(s, h); s.db.prepare("UPDATE orders SET is_test=1 WHERE id=?").run(testOrder.id);
    const generic = (await ask(unpaid)).json.message;
    assert.match(generic, /If this order is eligible/);
    for (const r of [await ask(notShipped), await ask(testOrder), await ask({ order_number: "HL-NOPE00" }), await ask(await shippedOrder(s, h), "other@example.com")]) {
      assert.equal(r.status, 200); assert.equal(r.json.message, generic, "no hint whether the order exists");
    }
    assert.equal(reviewMails().length, 0);
    assert.equal((await s.req("POST", "/api/reviews/verification-request", { orderNumber: "x", email: "nope" })).status, 400);

    // Eligible: shipped, paid, real → one e-mail to the order address; the stored copy has no link
    const good = await shippedOrder(s, h);
    assert.equal((await ask(good, "JANE@example.com ")).json.message, generic);
    assert.equal(reviewMails().length, 1); assert.deepEqual(reviewMails()[0].to, ["jane@example.com"]);
    const token = tokenFrom(reviewMails()[0]); assert.ok(token);
    const stored = s.db.prepare("SELECT body FROM emails WHERE kind='review_verify'").get().body;
    assert.equal(stored.includes(token), false); assert.match(stored, /not stored/);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM review_tokens WHERE token_hash=?").get(token).n, 0, "only a hash is stored");
    assert.deepEqual((await s.req("GET", `/api/reviews/verification?token=${token}`)).json, { valid: true });

    const r = await s.req("POST", "/api/reviews", review({ verificationToken: token, purchasedFromHavenLume: "no" }));
    assert.equal(r.status, 201); assert.equal(r.json.verifiedPurchase, true, "verification comes from the order, not the Yes/No answer");
    const row = s.db.prepare("SELECT * FROM reviews").get();
    assert.equal(row.purchase_verification_status, "verified"); assert.equal(row.purchase_order_id, good.id); assert.equal(row.moderation_status, "pending");
    assert.equal((await s.req("POST", "/api/reviews", review({ verificationToken: token, comment: VALID.comment + " Again." }))).status, 400, "single use");
    assert.deepEqual((await s.req("GET", `/api/reviews/verification?token=${token}`)).json, { valid: false });
    // One verified review per order; no new link for an order already reviewed
    assert.equal((await ask(good)).json.message, generic); assert.equal(reviewMails().length, 1);

    await s.req("POST", `/api/admin/reviews/${row.id}/approve`, {}, h);
    const pub = (await s.req("GET", "/api/reviews")).json.reviews[0];
    assert.equal(pub.verifiedPurchase, true); assert.equal(JSON.stringify(pub).includes(good.order_number), false);

    // Refunded after the link was sent → the review is accepted but marked ineligible (no badge)
    const later = await shippedOrder(s, h);
    await ask(later); const t2 = tokenFrom(reviewMails().at(-1));
    s.db.prepare("UPDATE orders SET payment_status='refunded' WHERE id=?").run(later.id);
    const r2 = await s.req("POST", "/api/reviews", review({ verificationToken: t2, comment: "The throw arrived but I returned it because the color was not what I expected." }));
    assert.equal(r2.status, 201); assert.equal(r2.json.verifiedPurchase, false);
    assert.equal(s.db.prepare("SELECT purchase_verification_status v FROM reviews ORDER BY id DESC").get().v, "ineligible");
    // Cancelled and partially refunded orders are never eligible
    for (const change of ["fulfillment_status='cancelled'", "payment_status='partially_refunded'"]) {
      const o = await shippedOrder(s, h); s.db.prepare(`UPDATE orders SET ${change} WHERE id=?`).run(o.id);
      const n = reviewMails().length; await ask(o); assert.equal(reviewMails().length, n, change);
    }
    // Expired links are refused
    const exp = await shippedOrder(s, h); await ask(exp); const t3 = tokenFrom(reviewMails().at(-1));
    s.db.prepare("UPDATE review_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE order_id=?").run(exp.id);
    assert.equal((await s.req("POST", "/api/reviews", review({ verificationToken: t3, comment: "Expired link review text that is long enough to pass." }))).status, 400);
    // The database refuses a "verified" review without an order
    assert.throws(() => s.db.prepare("UPDATE reviews SET purchase_verification_status='verified', purchase_order_id=NULL WHERE id=?").run(row.id), /CHECK constraint/);
  } finally { s.close(); notify.setFetchForTests((...a) => fetch(...a)); }
});

test("R13. without an e-mail provider, verification and review requests are refused and nothing is claimed", async () => {
  const s = await startStore(many);
  try {
    const h = await s.login();
    assert.equal((await s.req("GET", "/api/config")).json.reviewVerificationAvailable, false);
    const r = await s.req("POST", "/api/reviews/verification-request", { orderNumber: "HL-ABCDEF12", email: "jane@example.com" });
    assert.equal(r.status, 503); assert.match(r.json.error, /isn't available yet/);
    const o = await shippedOrder(s, h, { delivered: true });
    const req = await s.req("POST", `/api/admin/orders/${o.id}/review-request`, {}, h);
    assert.equal(req.status, 409); assert.match(req.json.error, /Nothing was sent/);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM emails WHERE kind LIKE 'review_%'").get().n, 0);
    assert.equal(s.db.prepare("SELECT review_requested_at r FROM orders WHERE id=?").get(o.id).r, null);
  } finally { s.close(); }
});

test("R14. post-delivery review request: delivered paid orders only, sent once, honest wording, no reward", async () => {
  const sent = fakeMail();
  const s = await startStore({ ...many, RESEND_API_KEY: "re_test", EMAIL_FROM: "HavenLume <shop@example.com>" });
  try {
    const h = await s.login();
    const shipped = await shippedOrder(s, h);
    assert.equal((await s.req("POST", `/api/admin/orders/${shipped.id}/review-request`, {}, h)).status, 409, "not delivered yet");
    const o = await shippedOrder(s, h, { delivered: true });
    const r = await s.req("POST", `/api/admin/orders/${o.id}/review-request`, {}, h);
    assert.equal(r.status, 200, r.text);
    const mail = sent.filter(m => /How is your/.test(m.subject));
    assert.equal(mail.length, 1);
    assert.match(mail[0].text, /honest review — positive or negative/); assert.match(mail[0].text, /no reward/);
    assert.doesNotMatch(mail[0].text, /discount|coupon|gift card|free|5[- ]star/i);
    assert.ok(tokenFrom(mail[0]));
    assert.equal((await s.req("POST", `/api/admin/orders/${o.id}/review-request`, {}, h)).status, 409, "never twice");
    assert.equal(sent.filter(m => /How is your/.test(m.subject)).length, 1);
    // The stored copy can't be re-sent or marked as sent manually
    const e = s.db.prepare("SELECT id FROM emails WHERE kind='review_request'").get();
    assert.equal((await s.req("POST", `/api/admin/emails/${e.id}/send`, {}, h)).status, 409);
    assert.equal((await s.req("POST", `/api/admin/emails/${e.id}/mark-sent`, {}, h)).status, 409);
    // Refunded delivered order: refused
    const refunded = await shippedOrder(s, h, { delivered: true }); s.db.prepare("UPDATE orders SET payment_status='refunded' WHERE id=?").run(refunded.id);
    assert.equal((await s.req("POST", `/api/admin/orders/${refunded.id}/review-request`, {}, h)).status, 409);
    // Provider failure: reported, nothing claimed, can be retried
    notify.setFetchForTests(async () => ({ ok: false, status: 500, json: async () => ({ message: "provider down" }) }));
    const o2 = await shippedOrder(s, h, { delivered: true });
    const fail = await s.req("POST", `/api/admin/orders/${o2.id}/review-request`, {}, h);
    assert.equal(fail.status, 502); assert.match(fail.json.error, /Nothing was sent/);
    assert.equal(s.db.prepare("SELECT review_requested_at r FROM orders WHERE id=?").get(o2.id).r, null);
  } finally { s.close(); notify.setFetchForTests((...a) => fetch(...a)); }
});

// ---------------------------------------------------------------- migration
test("R15. v6 migration: constraints hold, rollback restores v5, re-applying works, orders are kept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-rev-mig-"));
  try {
    const file = path.join(dir, "m.sqlite");
    let db = open(file);
    assert.equal(db.pragma("user_version", { simple: true }), 6);
    const ins = db.prepare(`INSERT INTO reviews(public_id,product_id,rating,display_name,comment,purchased_from_havenlume,publication_consent,fingerprint,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const ok = ["p1", "usb-heated-throw", 5, "Dana", "x".repeat(20), "yes", 1, "f1", "t", "t"];
    for (const [i, v] of [[2, 6], [2, 0], [3, "A"], [4, "short"], [5, "maybe"], [6, 0]]) {
      const row = [...ok]; row[i] = v; row[0] = `bad${i}${v}`;
      assert.throws(() => ins.run(...row), /CHECK constraint/, `column ${i} = ${v}`);
    }
    assert.throws(() => db.prepare("INSERT INTO reviews(public_id,product_id,rating,display_name,comment,purchased_from_havenlume,publication_consent,fingerprint,created_at,updated_at,moderation_status) VALUES('p2','usb-heated-throw',5,'Dana','" + "x".repeat(20) + "','yes',1,'f','t','t','published')").run(), /CHECK constraint/);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('reviews','review_moderation_history')").all().map(r => r.name);
    for (const n of ["reviews_product_status", "reviews_status_created", "reviews_one_per_order", "review_history_review"]) assert.ok(idx.includes(n), n);
    db.prepare("INSERT INTO orders(order_number,created_at,updated_at,customer_name,customer_email,address1,city,state,postal_code,subtotal_cents,total_cents,est_product_cost_cents,est_shipping_cost_cents) VALUES('HL-KEEP01','t','t','A','a@b.co','1','c','TX','78701',1,1,1,1)").run();
    rollbackReviews(db);
    assert.equal(db.pragma("user_version", { simple: true }), 5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'review%'").get().n, 0);
    assert.equal(db.prepare("SELECT order_number FROM orders").get().order_number, "HL-KEEP01");
    db.close();
    db = open(file); // re-applies v6
    assert.equal(db.pragma("user_version", { simple: true }), 6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM reviews").get().n, 0);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
