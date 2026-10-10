// Product facts (admin-confirmed specs) and the "no unverified claims" guard on public pages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const productFacts = require("../src/product-facts");
const { startStore } = require("./helpers");

test("product facts: admin-only, CSRF-protected, audited", async () => {
  const s = await startStore();
  try {
    assert.equal((await s.req("GET", "/api/admin/product-facts")).status, 401);
    assert.equal((await s.req("POST", "/api/admin/product-facts", { dimensions: "50 × 60 in" })).status, 401);
    const h = await s.login();
    assert.equal((await s.req("POST", "/api/admin/product-facts", { dimensions: "50 × 60 in" }, { Cookie: h.Cookie })).status, 403, "CSRF token required");
    assert.equal((await s.req("POST", "/api/admin/product-facts", { dimensions: "50 × 60 in" }, { ...h, Origin: "https://evil.example" })).status, 403);

    const fresh = await s.req("GET", "/api/admin/product-facts", undefined, h);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.json.missing.length, productFacts.FIELDS.length, "nothing is pre-filled or guessed");
    assert.equal((await s.req("GET", "/api/admin/dashboard", undefined, h)).json.productFactsMissing, productFacts.FIELDS.length);

    const ok = await s.req("POST", "/api/admin/product-facts", { dimensions: " 50 × 60 in ", powerBankIncluded: "no", inBox: "1 heated throw\r\n\r\n1 user manual\n" }, h);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.facts.dimensions, "50 × 60 in");
    assert.equal(ok.json.missing.length, productFacts.FIELDS.length - 3);
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='product_facts_updated'").get().n >= 1);
    // A partial save keeps the other fields
    await s.req("POST", "/api/admin/product-facts", { weight: "2 lb" }, h);
    assert.equal((await s.req("GET", "/api/admin/product-facts", undefined, h)).json.facts.dimensions, "50 × 60 in");
  } finally { s.close(); }
});

test("product facts: validation rejects bad values", async () => {
  const s = await startStore();
  try {
    const h = await s.login();
    for (const [body, msg] of [
      [{ powerBankIncluded: "maybe" }, /Invalid value/],
      [{ materials: "<script>alert(1)</script>" }, /can't contain/],
      [{ weight: "x".repeat(61) }, /too long/],
    ]) {
      const r = await s.req("POST", "/api/admin/product-facts", body, h);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, msg);
    }
    assert.equal((await s.req("GET", "/api/admin/product-facts", undefined, h)).json.missing.length, productFacts.FIELDS.length, "nothing saved on error");
  } finally { s.close(); }
});

test("product facts: the public catalog only exposes confirmed values", async () => {
  const s = await startStore();
  try {
    const before = (await s.req("GET", "/api/catalog")).json;
    assert.deepEqual(before.facts, {}, "no facts are published until confirmed");
    assert.equal(before.factLabels.dimensions, "Dimensions");
    const h = await s.login();
    await s.req("POST", "/api/admin/product-facts", { powerInput: "USB-A, 5 V", powerBankIncluded: "no", inBox: "1 heated throw\n\n1 manual", warranty: "" }, h);
    const after = (await s.req("GET", "/api/catalog")).json.facts;
    assert.deepEqual(after, { powerInput: "USB-A, 5 V", powerBankIncluded: "no", inBox: ["1 heated throw", "1 manual"] });
    // Internal fields (SKU, compliance documents) are never published
    await s.req("POST", "/api/admin/product-facts", { sku: "CJ-SECRET-1", complianceDocs: "Lab report 123", manualReceived: "yes", notIncluded: "USB power bank" }, h);
    const pub = (await s.req("GET", "/api/catalog")).json;
    assert.equal(JSON.stringify(pub).includes("CJ-SECRET-1"), false); assert.equal(JSON.stringify(pub).includes("Lab report"), false);
    assert.equal(pub.factLabels.sku, undefined); assert.equal(pub.factLabels.complianceDocs, undefined);
    assert.deepEqual(pub.facts.notIncluded, ["USB power bank"]);
  } finally { s.close(); }
});

// Words that would amount to an unverified certification, a medical claim, fake social
// proof, fake urgency, or permission to use the throw while asleep.
const FORBIDDEN = [
  /\b(UL|ETL|FCC|FDA|CE|CPSC)[ -]?(listed|certified|approved|compliant)\b/i,
  /\bcertified\b/i,
  /circulation|pain relief|relieves? pain|therapeutic|therapy|\bcures?\b|\bheals?\b|arthritis|cramps/i,
  // Ratings and review counts may only come from /api/reviews (approved reviews), never from static text.
  /\d[\d,.]*\s*(\+\s*)?(reviews|happy customers|sold)\b|rated \d|\b[1-5](\.\d)?\s*(\/|out of)\s*5\b|aggregateRating|ratingValue/i,
  /only \d+ left|selling fast|hurry|ends (tonight|soon)|countdown|limited stock/i,
  /safe (for|while) sleep|sleep with it|overnight use|all night/i,
  /\b\d+\s*(hours?|hrs?) (of )?(battery|warmth|heat)\b/i,
  /\bwas \$\d|\bcompare at\b/i,
];

test("public pages and scripts make no unverified claims", () => {
  const pub = path.join(__dirname, "..", "public");
  const files = [
    ...fs.readdirSync(pub).filter(f => f.endsWith(".html") && !f.startsWith("admin")).map(f => path.join(pub, f)),
    ...fs.readdirSync(path.join(pub, "js")).filter(f => !f.startsWith("admin")).map(f => path.join(pub, "js", f)),
    path.join(__dirname, "..", "src", "seo.js"),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `${path.relative(pub, file)} matches ${re}`);
    // Star glyphs are drawn only by the review script from real data, never written into a page.
    if (file.endsWith(".html")) assert.doesNotMatch(text, /★|☆|&#9733;|&starf;/, `${path.relative(pub, file)} contains a hardcoded star rating`);
    // "sleep" may only appear in a prohibition (or in a question that is answered with one)
    for (const m of text.matchAll(/[^.!?<>]*\bsleep\w*[^.!?<>]*/gi)) {
      if (text[m.index + m[0].length] === "?") continue;
      assert.match(m[0], /\b(not|never|don't)\b/i, `${path.relative(pub, file)}: "${m[0].trim()}"`);
    }
  }
});

test("product page has every required section and a mobile buy bar", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "product.html"), "utf8");
  for (const id of ["buy", "benefits", "power", "specs", "in-box", "safety", "shipping-info", "returns-info", "fit", "product-faq", "stickyBuy", "stickyAdd", "addToCart"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /Is it right for you\?/);
  assert.match(html, /Never use it while sleeping/);
});
