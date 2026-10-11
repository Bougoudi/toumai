// Marketing center: campaigns + UTM links, content calendar, promo banner, and a
// campaign report built only from data the store really has (its own analytics and its
// verified orders). Nothing is published to social networks from here.
const { orderProfit } = require("./profit");
const promotions = require("./promotions");
const { slugify, buildUrl, UTM_RE } = require("./utm");

class MarketingError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const CHANNELS = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", google: "Google", email: "Email", other: "Other" };
const DEFAULT_SOURCE = { tiktok: "tiktok", instagram: "instagram", facebook: "facebook", youtube: "youtube", google: "google", email: "newsletter", other: "other" };
const MEDIUMS = ["social", "paid_social", "video", "cpc", "email", "influencer", "referral", "other"];
const ANGLES = { work_from_home: "Comfort while working from home", relaxing_at_home: "Relaxing moments at home", cold_season_gifts: "Gift ideas for the cold season", other: "Other" };
const STATUSES = ["idea", "to_produce", "ready", "published"];
const PAID = "('paid','partially_refunded','refunded')";
const now = () => new Date().toISOString();

const text = (v, max) => { const s = String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim(); return s ? s.slice(0, max) : null; };
const dateOnly = (v, label) => {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new MarketingError(`${label}: use YYYY-MM-DD.`);
  return s;
};
const money = (v, label) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new MarketingError(`${label}: invalid amount.`);
  return Math.round(n * 100);
};
const path = (v) => {
  const p = String(v || "/product").trim();
  if (!/^\/[A-Za-z0-9/_-]*$/.test(p) || p.startsWith("//")) throw new MarketingError("Landing page must be a path on the store, like /product.");
  return p;
};
const utmPart = (v, label) => {
  const s = String(v || "").trim().toLowerCase();
  if (!UTM_RE.test(s)) throw new MarketingError(`${label}: lowercase letters, digits, dot, dash or underscore (max 60).`);
  return s;
};

// ---------------------------------------------------------------- campaigns
function saveCampaign(db, b, id) {
  const ex = id ? db.prepare("SELECT * FROM campaigns WHERE id=?").get(id) : null;
  if (id && !ex) throw new MarketingError("Campaign not found.", 404);
  const name = text(b.name ?? ex?.name, 100);
  if (!name) throw new MarketingError("Campaign name is required.");
  const channel = String(b.channel ?? ex?.channel ?? "");
  if (!CHANNELS[channel]) throw new MarketingError("Choose a channel.");
  const slug = utmPart(b.slug || ex?.slug || slugify(name), "Campaign tag (utm_campaign)");
  const source = utmPart(b.utmSource || ex?.utm_source || DEFAULT_SOURCE[channel], "utm_source");
  const medium = utmPart(b.utmMedium || ex?.utm_medium || "social", "utm_medium");
  const start = dateOnly(b.startDate ?? ex?.start_date, "Start date");
  const end = dateOnly(b.endDate ?? ex?.end_date, "End date");
  if (start && end && end < start) throw new MarketingError("End date must be after the start date.");
  const v = [name, slug, channel, source, medium, text(b.objective ?? ex?.objective, 300), path(b.landingPath ?? ex?.landing_path),
    b.budget !== undefined ? money(b.budget, "Budget") : ex?.budget_cents ?? null,
    b.spend !== undefined ? (money(b.spend, "Spend") ?? 0) : ex?.spend_cents ?? 0,
    start, end, text(b.notes ?? ex?.notes, 2000), b.archived !== undefined ? (b.archived === true || b.archived === "1" ? 1 : 0) : ex?.archived ?? 0];
  try {
    if (ex) {
      db.prepare(`UPDATE campaigns SET name=?,slug=?,channel=?,utm_source=?,utm_medium=?,objective=?,landing_path=?,budget_cents=?,spend_cents=?,
        start_date=?,end_date=?,notes=?,archived=?,updated_at=? WHERE id=?`).run(...v, now(), id);
      return id;
    }
    return db.prepare(`INSERT INTO campaigns(name,slug,channel,utm_source,utm_medium,objective,landing_path,budget_cents,spend_cents,start_date,end_date,notes,archived,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...v, now(), now()).lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new MarketingError("Another campaign already uses this campaign tag.");
    throw e;
  }
}

function campaignUrl(cfg, c, content) {
  return buildUrl(cfg.publicUrl || "http://localhost:3000", c.landing_path, { source: c.utm_source, medium: c.utm_medium, campaign: c.slug, content });
}

// ---------------------------------------------------------------- content calendar
function saveContent(db, b, id) {
  const ex = id ? db.prepare("SELECT * FROM content_items WHERE id=?").get(id) : null;
  if (id && !ex) throw new MarketingError("Content item not found.", 404);
  const title = text(b.title ?? ex?.title, 120);
  if (!title) throw new MarketingError("Title is required.");
  const angle = String(b.angle ?? ex?.angle ?? "");
  if (!ANGLES[angle]) throw new MarketingError("Choose an angle.");
  const channel = String(b.channel ?? ex?.channel ?? "");
  if (!CHANNELS[channel]) throw new MarketingError("Choose a channel.");
  const status = String(b.status ?? ex?.status ?? "idea");
  if (!STATUSES.includes(status)) throw new MarketingError("Invalid status.");
  const url = text(b.publishedUrl ?? ex?.published_url, 500);
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new MarketingError("Published URL must start with https://");
  if (status === "published" && !url) throw new MarketingError("Add the published URL to mark this content as published.");
  let campaignId = b.campaignId !== undefined ? (b.campaignId === "" || b.campaignId === null ? null : Number(b.campaignId)) : ex?.campaign_id ?? null;
  if (campaignId !== null && !db.prepare("SELECT id FROM campaigns WHERE id=?").get(campaignId)) throw new MarketingError("Unknown campaign.");
  const utmContent = utmPart(b.utmContent || ex?.utm_content || slugify(title) || "content", "utm_content");
  const v = [angle, title, text(b.hook ?? ex?.hook, 300), text(b.script ?? ex?.script, 6000), channel, status,
    dateOnly(b.publishDate ?? ex?.publish_date, "Publish date"), url, campaignId, utmContent, text(b.notes ?? ex?.notes, 2000)];
  if (ex) {
    db.prepare(`UPDATE content_items SET angle=?,title=?,hook=?,script=?,channel=?,status=?,publish_date=?,published_url=?,campaign_id=?,utm_content=?,notes=?,updated_at=? WHERE id=?`).run(...v, now(), id);
    return id;
  }
  return db.prepare(`INSERT INTO content_items(angle,title,hook,script,channel,status,publish_date,published_url,campaign_id,utm_content,notes,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...v, now(), now()).lastInsertRowid;
}

function listContent(db, cfg) {
  return db.prepare(`SELECT c.*, k.name campaign_name FROM content_items c LEFT JOIN campaigns k ON k.id=c.campaign_id
    ORDER BY COALESCE(c.publish_date,'9999') ASC, c.id DESC`).all().map(c => {
    const k = c.campaign_id ? db.prepare("SELECT * FROM campaigns WHERE id=?").get(c.campaign_id) : null;
    return { ...c, tracking_url: k ? campaignUrl(cfg, k, c.utm_content) : null };
  });
}

// Starter drafts: ideas only, no product claims beyond what the store publishes.
// Timing follows public Google Trends analyses (docs/GOOGLE_TRENDS_INSIGHTS.md): searches for
// heated throw blankets start rising in October and peak in November–December.
const SEASON_NOTE = "Timing: US searches for heated throw blankets rise in October and peak in November–December (secondary Google Trends data — see docs/GOOGLE_TRENDS_INSIGHTS.md). No countdowns or invented urgency.";
/** Next occurrence (today or later) of a month/day, as YYYY-MM-DD. */
function nextDate(month, day, from = new Date()) {
  const y = from.getUTCFullYear();
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d < new Date(Date.UTC(y, from.getUTCMonth(), from.getUTCDate()))) d.setUTCFullYear(y + 1);
  return d.toISOString().slice(0, 10);
}
const STARTERS = [
  { angle: "other", channel: "instagram", title: "USB power, explained in 20 seconds", when: [10, 15],
    hook: "Does a USB heated throw need a power bank? Here's exactly how ours is powered.",
    script: "1. Close-up: the throw's USB cable (1.5 m).\n2. Plug it into a USB wall adapter — it plugs straight in.\n3. Or show a USB power bank, with text on screen: \"Power bank not included.\"\n4. Mention automatic shut-off and overheat protection.\n5. End card: full specs on the product page.\nOnly use facts listed on the product page; no heat, battery-life or health claims." },
  { angle: "work_from_home", channel: "tiktok", title: "The 3 p.m. home-office reset", when: [10, 22],
    hook: "Working from home and the afternoon chill hits? Here's my desk-chair reset.",
    script: "1. Wide shot: home-office chair, laptop, mug.\n2. Close-up of the throw's square texture as you drape it over your shoulders.\n3. Show it connected to the USB power source described in the instructions.\n4. Back to typing, relaxed. Text on screen: \"Small comforts, long workdays.\"\n5. End card: HavenLume — link in bio.\nNo temperature, safety or health claims; only show what the product really does." },
  { angle: "relaxing_at_home", channel: "instagram", title: "A 10-minute evening reset", when: [11, 5],
    hook: "Phone down. Tea on. Ten minutes that are just yours.",
    script: "1. Slow pan: lamp, book, tea.\n2. Hands unfold the throw; close-up of the plush texture.\n3. Settle on the sofa, wrap up, open the book.\n4. Caption: \"Your cozy moment starts here.\"\nUse real footage of the product you sell; no before/after or wellness promises." },
  { angle: "cold_season_gifts", channel: "youtube", title: "A gift for the person who's always cold", when: [11, 20],
    hook: "Everyone has one friend who is always cold. This one's for them.",
    script: "1. Wrapped gift on a table; unwrap.\n2. Show the throw, its texture and what's in the box (only items really included).\n3. Mention the color available and that details are on the product page.\n4. Do not promise delivery by a holiday date unless the carrier estimate has been verified." },
];
function addStarters(db) {
  const ids = [];
  for (const s of STARTERS) {
    if (db.prepare("SELECT id FROM content_items WHERE title=?").get(s.title)) continue;
    const { when, ...item } = s;
    ids.push(saveContent(db, { ...item, status: "idea", publishDate: nextDate(when[0], when[1]), notes: SEASON_NOTE }));
  }
  return ids;
}

// ---------------------------------------------------------------- banner
const BANNER_KEYS = ["banner_enabled", "banner_text", "banner_link", "banner_promo", "banner_starts_at", "banner_ends_at"];
function getBanner(db) {
  const rows = db.prepare(`SELECT key,value FROM settings WHERE key IN (${BANNER_KEYS.map(() => "?").join(",")})`).all(...BANNER_KEYS);
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { enabled: s.banner_enabled === "1", text: s.banner_text || "", link: s.banner_link || "", promo: s.banner_promo || "",
    startsAt: s.banner_starts_at || "", endsAt: s.banner_ends_at || "" };
}
function saveBanner(db, b) {
  const t = text(b.text, 120) || "";
  const enabled = b.enabled === true || b.enabled === "1" || b.enabled === "on";
  if (enabled && !t) throw new MarketingError("Banner text is required to enable the banner.");
  if (/[<>]/.test(t)) throw new MarketingError("Banner text can't contain < or >.");
  const link = b.link ? path(b.link) : "";
  const promo = promotions.normCode(b.promo);
  if (promo && !db.prepare("SELECT id FROM promotions WHERE code=?").get(promo)) throw new MarketingError("Unknown promo code.");
  const iso = (v, label) => { if (!v) return ""; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new MarketingError(`${label}: invalid date.`); return d.toISOString(); };
  const startsAt = iso(b.startsAt, "Start"); const endsAt = iso(b.endsAt, "End");
  if (enabled && (!startsAt || !endsAt)) throw new MarketingError("A banner needs real start and end dates.");
  if (startsAt && endsAt && endsAt <= startsAt) throw new MarketingError("The end must be after the start.");
  const up = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.transaction(() => {
    up.run("banner_enabled", enabled ? "1" : "0"); up.run("banner_text", t); up.run("banner_link", link);
    up.run("banner_promo", promo); up.run("banner_starts_at", startsAt); up.run("banner_ends_at", endsAt);
  })();
  return getBanner(db);
}
/** The banner visitors see right now, or null. A linked promo must itself be valid now. */
function activeBanner(db, at = now()) {
  const b = getBanner(db);
  if (!b.enabled || !b.text || !b.startsAt || !b.endsAt || at < b.startsAt || at > b.endsAt) return null;
  let promo = null;
  if (b.promo) {
    const p = db.prepare("SELECT * FROM promotions WHERE code=?").get(b.promo);
    if (!p || !p.active || at < p.starts_at || at > p.ends_at) return null; // never advertise a code that won't work
    promo = { code: p.code, conditions: promotions.describe(p) };
  }
  return { text: b.text, link: b.link || null, promo };
}

// ---------------------------------------------------------------- report
function campaignReport(db, cfg) {
  const campaigns = db.prepare("SELECT * FROM campaigns ORDER BY archived ASC, id DESC").all();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const rows = campaigns.map(c => {
    const s = one("SELECT COUNT(*) sessions, COUNT(DISTINCT visitor) visitors FROM analytics_sessions WHERE utm_campaign=?", c.slug);
    const ev = Object.fromEntries(db.prepare(`SELECT e.name, COUNT(*) n FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id
      WHERE s.utm_campaign=? AND e.type='event' GROUP BY e.name`).all(c.slug).map(r => [r.name, r.n]));
    const orders = db.prepare("SELECT * FROM orders WHERE is_test=0 AND utm_campaign=?").all(c.slug);
    const paid = orders.filter(o => ["paid", "partially_refunded", "refunded"].includes(o.payment_status));
    let revenue = 0, contribution = 0, discounts = 0, orderAds = 0, estimated = 0;
    for (const o of paid) {
      const p = orderProfit(o);
      revenue += p.revenue_cents;
      contribution += p.profit_cents + p.ad_spend_cents; // campaign spend is counted once, below
      discounts += o.discount_cents || 0;
      orderAds += o.ad_spend_cents || 0;
      estimated += [p.product_cost, p.shipping_cost, p.payment_fee].filter(x => x.basis === "estimated").length;
    }
    const spend = c.spend_cents || 0;
    const profit = contribution - spend;
    const flags = [];
    if (!s.sessions && !orders.length) flags.push("No tracked visits or orders yet for this campaign tag.");
    if (!spend) flags.push("No ad spend recorded — cost per customer and profit after ads are unknown.");
    if (!paid.length) flags.push("No confirmed payment yet — profitability not demonstrated.");
    if (paid.length && spend && profit < 0) flags.push("Loss after recorded ad spend.");
    if (orderAds) flags.push("Some orders also have ad spend recorded on the order itself; record ads on the campaign only, to avoid counting them twice.");
    if (estimated) flags.push(`${estimated} cost item(s) are still estimates; record actual supplier and fee costs on the orders.`);
    return {
      id: c.id, name: c.name, slug: c.slug, channel: c.channel, channel_label: CHANNELS[c.channel], utm_source: c.utm_source, utm_medium: c.utm_medium,
      objective: c.objective, landing_path: c.landing_path, budget_cents: c.budget_cents, spend_cents: spend,
      start_date: c.start_date, end_date: c.end_date, notes: c.notes, archived: Boolean(c.archived), url: campaignUrl(cfg, c),
      tracked: { sessions: s.sessions, visitors: s.visitors, product_views: ev.view_item || 0, add_to_cart: ev.add_to_cart || 0, begin_checkout: ev.begin_checkout || 0 },
      orders_created: orders.length, paid_orders: paid.length, revenue_cents: revenue, discounts_cents: discounts,
      contribution_before_ads_cents: contribution, profit_after_spend_cents: spend || paid.length ? profit : null,
      cac_cents: spend && paid.length ? Math.round(spend / paid.length) : null,
      roas: spend && paid.length ? Math.round(revenue / spend * 100) / 100 : null,
      flags,
    };
  });
  // Where visits and orders came from, campaign or not.
  const sources = db.prepare(`SELECT COALESCE(utm_source, referrer, '(direct / unknown)') source, COUNT(*) sessions
    FROM analytics_sessions GROUP BY 1 ORDER BY sessions DESC LIMIT 15`).all();
  const orderSources = db.prepare(`SELECT COALESCE(utm_source,'(no campaign tag)') source, COUNT(*) orders,
    SUM(payment_status IN ${PAID}) paid FROM orders WHERE is_test=0 GROUP BY 1 ORDER BY orders DESC`).all();
  return { campaigns: rows, sources, orderSources, generatedAt: now() };
}

module.exports = { CHANNELS, MEDIUMS, ANGLES, STATUSES, DEFAULT_SOURCE, MarketingError,
  saveCampaign, campaignUrl, saveContent, listContent, addStarters, getBanner, saveBanner, activeBanner, campaignReport };
