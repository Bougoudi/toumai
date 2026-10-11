// Optional marketing tags (GA4, Meta Pixel, TikTok Pixel, Pinterest Tag).
// Nothing loads unless the owner sets a public ID in the environment. The browser loads them
// only for visitors who haven't opted out (and never with Global Privacy Control / Do Not Track),
// see public/js/tags.js. The CSP is widened only for the providers that are configured.
const PROVIDERS = {
  ga4: { env: "GA4_MEASUREMENT_ID", re: /^G-[A-Z0-9]{4,15}$/,
    script: ["https://www.googletagmanager.com"], connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"], img: ["https://*.google-analytics.com", "https://www.googletagmanager.com"] },
  meta: { env: "META_PIXEL_ID", re: /^\d{6,20}$/,
    script: ["https://connect.facebook.net"], connect: ["https://www.facebook.com", "https://connect.facebook.net"], img: ["https://www.facebook.com"] },
  tiktok: { env: "TIKTOK_PIXEL_ID", re: /^[A-Z0-9]{10,30}$/,
    script: ["https://analytics.tiktok.com"], connect: ["https://analytics.tiktok.com"], img: ["https://analytics.tiktok.com"] },
  pinterest: { env: "PINTEREST_TAG_ID", re: /^\d{6,20}$/,
    script: ["https://s.pinimg.com"], connect: ["https://ct.pinterest.com"], img: ["https://ct.pinterest.com"] },
};

/** Valid configured IDs only; an invalid value is ignored rather than loaded. */
function fromEnv(env) {
  const out = {};
  for (const [k, p] of Object.entries(PROVIDERS)) {
    const v = String(env[p.env] || "").trim().toUpperCase();
    if (v && p.re.test(v)) out[k] = v;
  }
  return out;
}

function csp(tags) {
  const add = { script: [], connect: [], img: [] };
  for (const k of Object.keys(tags || {})) for (const d of Object.keys(add)) add[d].push(...PROVIDERS[k][d]);
  return add;
}

module.exports = { PROVIDERS, fromEnv, csp };
