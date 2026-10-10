// Promo codes. Every discount is computed and validated on the server, at checkout and
// again inside the order total sent to iyzico — the browser only displays the result.
// Rules are explicit (amount, minimum, dates, usage cap) and shown to the customer.
const now = () => new Date().toISOString();

class PromoError extends Error { constructor(message) { super(message); this.status = 400; } }

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const normCode = (c) => String(c || "").trim().toUpperCase();
const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

/** Human-readable conditions, used in the banner, at checkout and in the admin. */
function describe(p) {
  const off = p.kind === "percent" ? `${p.value}% off` : `${usd(p.value)} off`;
  const parts = [`${off} your order subtotal`];
  if (p.min_subtotal_cents > 0) parts.push(`on orders of ${usd(p.min_subtotal_cents)} or more`);
  parts.push(`valid until ${new Date(p.ends_at).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`);
  if (p.max_redemptions) parts.push(`limited to the first ${p.max_redemptions} orders`);
  return `${parts.join(", ")}. Not combinable; shipping excluded.`;
}

function paidRedemptions(db, code) {
  return db.prepare(`SELECT COUNT(*) n FROM orders WHERE promo_code=? AND is_test=0
    AND payment_status IN ('paid','partially_refunded','refunded')`).get(code).n;
}

/** Returns the promotion row if it can be used right now on this subtotal, else throws. */
function resolve(db, rawCode, subtotalCents, at = now()) {
  const code = normCode(rawCode);
  if (!code) return null;
  if (!CODE_RE.test(code)) throw new PromoError("This promo code is not valid.");
  const p = db.prepare("SELECT * FROM promotions WHERE code=?").get(code);
  if (!p || !p.active) throw new PromoError("This promo code is not valid.");
  if (at < p.starts_at) throw new PromoError("This promo code is not active yet.");
  if (at > p.ends_at) throw new PromoError("This promo code has expired.");
  if (subtotalCents < p.min_subtotal_cents) throw new PromoError(`This code requires an order subtotal of at least ${usd(p.min_subtotal_cents)}.`);
  if (p.max_redemptions && paidRedemptions(db, code) >= p.max_redemptions) throw new PromoError("This promo code has reached its usage limit.");
  return p;
}

function discountFor(p, subtotalCents) {
  if (!p) return 0;
  const d = p.kind === "percent" ? Math.round(subtotalCents * p.value / 100) : p.value;
  return Math.max(0, Math.min(d, subtotalCents - 100)); // at least $1.00 of product is always charged
}

/** Spreads a discount across order lines (cents), so each line stays > 0 and the sum is exact. */
function allocate(lines, discountCents) {
  const total = lines.reduce((s, l) => s + l.line_total_cents, 0);
  let left = discountCents;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.floor(discountCents * l.line_total_cents / total);
    left -= share;
    return { ...l, discounted_cents: l.line_total_cents - share };
  });
}

// ---------------------------------------------------------------- admin
const int = (v) => Number.parseInt(v, 10);
function validateInput(b, existing) {
  const out = {};
  const code = normCode(b.code ?? existing?.code);
  if (!CODE_RE.test(code)) throw new PromoError("Code: 3–24 letters, digits or dashes (e.g. COZY10).");
  out.code = code;
  out.description = String(b.description ?? existing?.description ?? "").trim().slice(0, 200) || null;
  out.kind = (b.kind ?? existing?.kind) === "fixed" ? "fixed" : "percent";
  if (out.kind === "percent") {
    out.value = int(b.value ?? existing?.value);
    if (!(out.value >= 1 && out.value <= 50)) throw new PromoError("Percentage must be between 1 and 50.");
  } else {
    out.value = Math.round(Number(b.value ?? (existing ? existing.value / 100 : NaN)) * 100);
    if (!(out.value >= 100 && out.value <= 50000)) throw new PromoError("Fixed amount must be between $1 and $500.");
  }
  const minUsd = b.minSubtotal ?? (existing ? existing.min_subtotal_cents / 100 : 0);
  out.min_subtotal_cents = Math.round(Number(minUsd || 0) * 100);
  if (!(out.min_subtotal_cents >= 0 && out.min_subtotal_cents <= 1000000)) throw new PromoError("Invalid minimum subtotal.");
  if (out.kind === "fixed" && out.min_subtotal_cents < out.value + 100) {
    throw new PromoError("For a fixed amount, set a minimum subtotal at least $1 above the discount.");
  }
  const date = (v, label) => {
    const d = new Date(String(v || ""));
    if (Number.isNaN(d.getTime())) throw new PromoError(`${label} is required.`);
    return d.toISOString();
  };
  out.starts_at = date(b.startsAt ?? existing?.starts_at, "Start date");
  out.ends_at = date(b.endsAt ?? existing?.ends_at, "End date");
  if (out.ends_at <= out.starts_at) throw new PromoError("The end date must be after the start date.");
  const max = b.maxRedemptions ?? existing?.max_redemptions;
  out.max_redemptions = max === "" || max === null || max === undefined ? null : int(max);
  if (out.max_redemptions !== null && !(out.max_redemptions >= 1 && out.max_redemptions <= 100000)) throw new PromoError("Invalid usage limit.");
  out.active = b.active === undefined ? (existing ? existing.active : 1)
    : (b.active === false || ["0", "false", "off", ""].includes(String(b.active)) ? 0 : 1);
  return out;
}

function list(db) {
  return db.prepare("SELECT * FROM promotions ORDER BY id DESC").all().map(p => ({
    ...p, conditions: describe(p), paid_redemptions: paidRedemptions(db, p.code),
    discount_given_cents: db.prepare(`SELECT COALESCE(SUM(discount_cents),0) c FROM orders WHERE promo_code=? AND is_test=0
      AND payment_status IN ('paid','partially_refunded','refunded')`).get(p.code).c,
    live: Boolean(p.active) && p.starts_at <= now() && now() <= p.ends_at,
  }));
}

function save(db, b, id) {
  const existing = id ? db.prepare("SELECT * FROM promotions WHERE id=?").get(id) : null;
  if (id && !existing) throw Object.assign(new PromoError("Promotion not found."), { status: 404 });
  const v = validateInput(b || {}, existing);
  const t = now();
  try {
    if (existing) {
      db.prepare(`UPDATE promotions SET code=?,description=?,kind=?,value=?,min_subtotal_cents=?,starts_at=?,ends_at=?,max_redemptions=?,active=?,updated_at=? WHERE id=?`)
        .run(v.code, v.description, v.kind, v.value, v.min_subtotal_cents, v.starts_at, v.ends_at, v.max_redemptions, v.active, t, id);
      return id;
    }
    return db.prepare(`INSERT INTO promotions(code,description,kind,value,min_subtotal_cents,starts_at,ends_at,max_redemptions,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(v.code, v.description, v.kind, v.value, v.min_subtotal_cents, v.starts_at, v.ends_at, v.max_redemptions, v.active, t, t).lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new PromoError("This code already exists.");
    throw e;
  }
}

module.exports = { resolve, discountFor, allocate, describe, list, save, normCode, PromoError };
