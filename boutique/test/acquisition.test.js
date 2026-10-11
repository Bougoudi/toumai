// Acquisition plumbing: optional marketing tags (IDs, CSP), color links, AI images kept out of
// Google, owner-confirmed costs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const tags = require("../src/tags");
const { catalog } = require("../src/catalog");
const { DEFAULT_SETTINGS } = require("../src/db");
const { referenceUnitCostCents } = require("../src/profit");
const { startStore } = require("./helpers");

test("T1. marketing tags: nothing configured = nothing loaded, CSP unchanged", async () => {
  const s = await startStore();
  try {
    const cfg = (await s.req("GET", "/api/config")).json;
    assert.deepEqual(cfg.tags, {});
    const csp = (await s.req("GET", "/")).headers.get("content-security-policy");
    assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /connect-src 'self'(;|$)/);
    for (const d of ["facebook", "tiktok", "pinimg", "googletagmanager"]) assert.equal(csp.includes(d), false, d);
  } finally { s.close(); }
});

test("T2. marketing tags: only valid public IDs are used; CSP widened only for those providers", async () => {
  assert.deepEqual(tags.fromEnv({ GA4_MEASUREMENT_ID: "g-abc123x", META_PIXEL_ID: "123456789012345", TIKTOK_PIXEL_ID: "bad id!", PINTEREST_TAG_ID: "<script>" }),
    { ga4: "G-ABC123X", meta: "123456789012345" });
  const s = await startStore({ META_PIXEL_ID: "123456789012345", PINTEREST_TAG_ID: "2612345678901" });
  try {
    assert.deepEqual((await s.req("GET", "/api/config")).json.tags, { meta: "123456789012345", pinterest: "2612345678901" });
    const csp = (await s.req("GET", "/")).headers.get("content-security-policy");
    assert.match(csp, /script-src 'self' https:\/\/connect\.facebook\.net https:\/\/s\.pinimg\.com/);
    assert.match(csp, /connect-src 'self' https:\/\/www\.facebook\.com https:\/\/connect\.facebook\.net https:\/\/ct\.pinterest\.com/);
    assert.equal(csp.includes("tiktok"), false); assert.equal(csp.includes("googletagmanager"), false);
    assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/, "no inline/eval scripts allowed");
  } finally { s.close(); }
  // The loader never sends personal data: no e-mail, name or address fields in the tag code
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "js", "tags.js"), "utf8");
  assert.doesNotMatch(js, /email|customer_name|address1|phone|\b(em|ph|external_id)\s*:/i);
  assert.match(js, /dataProcessingOptions", \["LDU"\]/, "Meta Limited Data Use");
});

test("T3. AI illustrations are labeled in the catalog and never sent to Google; images carry IPTC metadata", async () => {
  const p = catalog({ priceUsd: 49.99 });
  const ai = p.images.filter(i => i.aiGenerated).map(i => i.src);
  assert.deepEqual(ai, ["/images/throw-white-reading.webp", "/images/throw-white-armchair.webp", "/images/throw-white-closeup.webp"]);
  for (const src of ai) for (const f of [src, src.replace(".webp", ".jpg"), src.replace(".webp", "-800.webp")]) {
    const bytes = fs.readFileSync(path.join(__dirname, "..", "public", f));
    assert.ok(bytes.includes("http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"), `${f} has IPTC DigitalSourceType`);
  }
  const s = await startStore({ PUBLIC_URL: "https://shop.example.com" });
  try {
    const feed = (await s.req("GET", "/feeds/google-merchant.xml")).text;
    const page = (await s.req("GET", "/product")).text;
    for (const out of [feed, page.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g).join("")]) {
      assert.doesNotMatch(out, /white-reading|white-armchair|white-closeup/);
    }
  } finally { s.close(); }
});

test("T4. owner cost figures: $17 product + $15 shipping = $32 per unit by default", () => {
  assert.equal(DEFAULT_SETTINGS.product_cost_usd, "17.00");
  assert.equal(referenceUnitCostCents(DEFAULT_SETTINGS), 3200);
});
