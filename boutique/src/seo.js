// SEO & sharing: canonical URLs, Open Graph / Twitter cards, JSON-LD, robots.txt,
// sitemap.xml and a Google Merchant Center product feed. Everything is generated from the
// catalog and the store's real settings: no ratings, reviews, certifications or delivery
// promises are ever emitted.
const fs = require("fs");
const path = require("path");
const { catalog } = require("./catalog");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Pages that should be indexed, with their social-share metadata.
const PAGES = {
  "/": { file: "index.html", image: "/images/og-default.jpg", type: "website", priority: "1.0" },
  "/product": { file: "product.html", image: "/images/og-product.jpg", type: "product", priority: "0.9" },
  "/faq": { file: "faq.html", priority: "0.5" },
  "/contact": { file: "contact.html", priority: "0.3" },
  "/shipping": { file: "shipping.html", priority: "0.3" },
  "/returns": { file: "returns.html", priority: "0.3" },
  "/privacy": { file: "privacy.html", priority: "0.2" },
  "/review-policy": { file: "review-policy.html", priority: "0.2", requires: "reviewsEnabled" },
  "/terms": { file: "terms.html", priority: "0.2" },
};
// Private or transactional pages: reachable, never indexed.
const NOINDEX = { "/cart": "cart.html", "/checkout": "checkout.html", "/order-status": "order-status.html", "/policies": "policies.html" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function baseUrl(cfg, req) {
  return cfg.publicUrl || `${req.protocol}://${req.get("host")}`;
}

function productJsonLd(cfg, base) {
  const p = catalog(cfg);
  const available = p.variants.some(v => v.available);
  const offer = {
    "@type": "Offer",
    url: `${base}/product`,
    priceCurrency: "USD",
    price: (p.priceCents / 100).toFixed(2),
    availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: cfg.businessName || cfg.storeName },
    // The store's own published policies (see /returns and /shipping).
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy", applicableCountry: "US",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: cfg.returnWindowDays, returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/ReturnShippingFees",
    },
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: cfg.shippingUsd.toFixed(2), currency: "USD" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
      // Delivery time is only published once the carrier estimate has been verified.
      ...(cfg.deliveryVerified ? { deliveryTime: { "@type": "ShippingDeliveryTime",
        transitTime: { "@type": "QuantitativeValue", minValue: cfg.deliveryMinDays, maxValue: cfg.deliveryMaxDays, unitCode: "DAY" } } } : {}),
    },
  };
  return {
    "@context": "https://schema.org", "@type": "Product",
    name: p.name, sku: p.sku,
    description: "A plush throw with a raised square texture and a USB connection, made for reading, unwinding and quiet evenings at home.",
    image: p.images.map(i => `${base}${i.src.replace(/\.webp$/, ".jpg")}`),
    brand: { "@type": "Brand", name: cfg.storeName },
    ...(p.variants.filter(v => v.available).length === 1 ? { color: p.variants.find(v => v.available).name } : {}),
    offers: offer,
  };
}

function headTags(cfg, req, route) {
  const base = baseUrl(cfg, req);
  const tags = [];
  if (NOINDEX[route]) {
    tags.push('<meta name="robots" content="noindex, follow">');
    return tags.join("\n");
  }
  const page = PAGES[route];
  const url = `${base}${route === "/" ? "/" : route}`;
  const image = `${base}${page.image || "/images/og-default.jpg"}`;
  tags.push(`<link rel="canonical" href="${esc(url)}">`);
  tags.push(`<meta property="og:site_name" content="${esc(cfg.storeName)}">`, `<meta property="og:type" content="${page.type === "product" ? "product" : "website"}">`,
    `<meta property="og:url" content="${esc(url)}">`, `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="en_US">', '<meta name="twitter:card" content="summary_large_image">');
  if (page.type === "product") {
    const p = catalog(cfg);
    tags.push(`<meta property="product:price:amount" content="${(p.priceCents / 100).toFixed(2)}">`, '<meta property="product:price:currency" content="USD">');
    tags.push(jsonLd(productJsonLd(cfg, base)));
  }
  if (route === "/") {
    if (cfg.googleSiteVerification) tags.push(`<meta name="google-site-verification" content="${esc(cfg.googleSiteVerification)}">`);
    tags.push(jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: cfg.storeName, url: `${base}/`, logo: `${base}/images/og-default.jpg`,
      ...(cfg.supportEmail ? { email: cfg.supportEmail } : {}) }));
    tags.push(jsonLd({ "@context": "https://schema.org", "@type": "WebSite", name: cfg.storeName, url: `${base}/` }));
  }
  return tags.join("\n");
}

/** Serves HTML pages with SEO tags injected (title/description stay in the HTML files). */
function pageMiddleware(cfg) {
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file) || !cfg.production) cache.set(file, fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"));
    return cache.get(file);
  };
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const route = req.path.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
    if (PAGES[route] && PAGES[route].requires && !cfg[PAGES[route].requires]) return res.status(404).type("text/plain").send("Not found");
    const file = (PAGES[route] || {}).file || NOINDEX[route];
    if (!file) return next();
    const html = read(file).replace("</head>", `${headTags(cfg, req, route)}\n</head>`);
    res.type("html").set("Cache-Control", "no-cache").send(html);
  };
}

function robots(cfg, req) {
  const base = baseUrl(cfg, req);
  return ["User-agent: *", "Disallow: /admin", "Disallow: /admin-login.html", "Disallow: /api/", "Disallow: /cart", "Disallow: /checkout", "Disallow: /order-status", "",
    `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
}

function sitemap(cfg, req) {
  const base = baseUrl(cfg, req);
  const urls = Object.entries(PAGES).filter(([, p]) => !p.requires || cfg[p.requires]).map(([route, p]) => `  <url><loc>${esc(base + route)}</loc><priority>${p.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * Google Merchant Center feed (RSS 2.0 + g: namespace), one item per AVAILABLE color.
 * identifier_exists=no: the product has no GTIN/MPN on record. Requires PUBLIC_URL.
 */
function merchantFeed(cfg) {
  if (!cfg.publicUrl) return null;
  const p = catalog(cfg);
  const base = cfg.publicUrl;
  // Google requires the image to show the listed color: each color uses its own photos, and
  // colors without their own photo are left out.
  const photosOf = (prod, variantId) => prod.images.filter(i => i.variant === variantId);
  const items = p.variants.filter(v => v.available && v.hasPhoto && photosOf(p, v.id).length).map(v => `  <item>
    <g:id>${esc(`${p.sku}-${v.id}`)}</g:id>
    <g:item_group_id>${esc(p.sku)}</g:item_group_id>
    <g:title>${esc(`${p.name} – ${v.name}`)}</g:title>
    <g:description>${esc("A plush throw with a raised square texture and a USB connection, made for reading, unwinding and quiet evenings at home. See the product page for confirmed specifications.")}</g:description>
    <g:link>${esc(`${base}/product`)}</g:link>
    <g:image_link>${esc(`${base}${photosOf(p, v.id)[0].src.replace(/\.webp$/, ".jpg")}`)}</g:image_link>
${photosOf(p, v.id).slice(1).map(i => `    <g:additional_image_link>${esc(base + i.src.replace(/\.webp$/, ".jpg"))}</g:additional_image_link>`).join("\n")}
    <g:availability>in_stock</g:availability>
    <g:price>${(p.priceCents / 100).toFixed(2)} USD</g:price>
    <g:condition>new</g:condition>
    <g:brand>${esc(cfg.storeName)}</g:brand>
    <g:identifier_exists>no</g:identifier_exists>
    <g:color>${esc(v.name)}</g:color>
    <g:shipping><g:country>US</g:country><g:price>${cfg.shippingUsd.toFixed(2)} USD</g:price></g:shipping>
  </item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${esc(cfg.storeName)}</title>
  <link>${esc(base)}</link>
  <description>${esc(cfg.storeName)} product feed</description>
${items.join("\n")}
</channel>
</rss>
`;
}

module.exports = { pageMiddleware, robots, sitemap, merchantFeed, productJsonLd, headTags, PAGES };
