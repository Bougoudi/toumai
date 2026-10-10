// Product facts. Every technical detail shown to customers comes from here, and only once
// the owner has confirmed it (from the supplier's documentation for the exact model).
// An empty field is shown as "being confirmed" — it is never guessed.
const FIELDS = [
  { key: "dimensions", label: "Dimensions", hint: 'e.g. 50 × 60 in (127 × 152 cm)', max: 120 },
  { key: "weight", label: "Weight", hint: "e.g. 2.2 lb (1 kg)", max: 60 },
  { key: "materials", label: "Materials / fabric", hint: "Exactly as on the care label, e.g. 100% polyester", max: 200 },
  { key: "powerInput", label: "Power input", hint: "e.g. USB-A, 5 V ⎓ 2 A", max: 120 },
  { key: "powerSource", label: "Compatible power sources", hint: "e.g. USB power bank or USB wall adapter, 5 V / 2 A or more", max: 200 },
  { key: "powerBankIncluded", label: "Power bank included?", choices: { "": "Not confirmed", no: "No — sold separately", yes: "Yes — included" } },
  { key: "cableLength", label: "USB cable length", hint: "e.g. 5 ft (1.5 m)", max: 60 },
  { key: "heatSettings", label: "Heat settings", hint: "e.g. 3 levels (low, medium, high)", max: 120 },
  { key: "controls", label: "Controls", hint: "e.g. one button on the throw: press to switch levels", max: 200 },
  { key: "autoShutoff", label: "Automatic shut-off", hint: 'e.g. "Yes, after 2 hours" or "No"', max: 120 },
  { key: "inBox", label: "What's in the box", hint: "One item per line, only items really included", max: 600, multiline: true },
  { key: "care", label: "Care instructions", hint: "Copy them from the care label / manual", max: 1000, multiline: true },
  { key: "manufacturerWarnings", label: "Manufacturer's safety instructions", hint: "Copy them from the manual", max: 2000, multiline: true },
  { key: "warranty", label: "Warranty", hint: "e.g. 1-year limited warranty from HavenLume", max: 200 },
  { key: "countryOfOrigin", label: "Country of origin", hint: "e.g. Made in China", max: 60 },
];
const KEY = "product_facts";

function get(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(KEY);
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  const out = {};
  for (const f of FIELDS) out[f.key] = typeof stored[f.key] === "string" ? stored[f.key] : "";
  return out;
}

class FactsError extends Error { constructor(m) { super(m); this.status = 400; } }

function save(db, body) {
  const current = get(db);
  for (const f of FIELDS) {
    if (body[f.key] === undefined) continue;
    let v = String(body[f.key] ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    if (f.choices) {
      if (!(v in f.choices)) throw new FactsError(`Invalid value for ${f.label}.`);
    } else {
      if (/[<>]/.test(v)) throw new FactsError(`${f.label} can't contain < or >.`);
      if (v.length > f.max) throw new FactsError(`${f.label} is too long (max ${f.max} characters).`);
    }
    current[f.key] = v;
  }
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(KEY, JSON.stringify(current));
  return current;
}

/** Fields still to confirm, in display order. */
function missing(facts) { return FIELDS.filter(f => !facts[f.key]).map(f => ({ key: f.key, label: f.label })); }

/** Public view: only confirmed values; lists split into lines. */
function publicFacts(facts) {
  const out = {};
  for (const f of FIELDS) {
    if (!facts[f.key]) continue;
    out[f.key] = f.key === "inBox" ? facts[f.key].split("\n").map(s => s.trim()).filter(Boolean)
      : f.choices ? facts[f.key] : facts[f.key];
  }
  return out;
}

module.exports = { FIELDS, get, save, missing, publicFacts, FactsError };
