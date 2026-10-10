// UTM campaign parameters: strict format, no free text, never personal data.
const RE = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const one = (v) => { const s = String(v ?? "").trim().toLowerCase(); return RE.test(s) ? s : null; };

/** Keeps only well-formed utm_source / medium / campaign / content values. */
function cleanUtm(u) {
  if (!u || typeof u !== "object") return null;
  const out = { source: one(u.source), medium: one(u.medium), campaign: one(u.campaign), content: one(u.content) };
  return out.source || out.campaign ? out : null;
}

const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** Builds a tracking URL for the store. */
function buildUrl(base, path, { source, medium, campaign, content }) {
  const u = new URL(path || "/", base || "http://localhost");
  if (source) u.searchParams.set("utm_source", source);
  if (medium) u.searchParams.set("utm_medium", medium);
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  if (content) u.searchParams.set("utm_content", content);
  return u.toString();
}

module.exports = { cleanUtm, slugify, buildUrl, UTM_RE: RE };
