// Product facts. Every technical detail shown to customers comes from here, and only once
// the owner has confirmed it (from the supplier's documentation for the exact model).
// An empty field is shown as "being confirmed" — it is never guessed.
// `internal` fields help the owner check orders and compliance; they are never published.
const FIELDS = [
  { key: "sku", label: "Supplier SKU (exact reference)", hint: "Exactly as on the supplier's listing / invoice", max: 120, internal: true },
  { key: "dimensions", label: "Dimensions", hint: 'e.g. 50 × 60 in (127 × 152 cm)', max: 120 },
  { key: "weight", label: "Weight", hint: "e.g. 2.2 lb (1 kg)", max: 60 },
  { key: "materials", label: "Materials / fabric", hint: "Exactly as on the care label, e.g. 100% polyester", max: 200 },
  { key: "powerInput", label: "Power input (voltage / current / wattage)", hint: "e.g. USB-A, 5 V ⎓ 2 A, 10 W", max: 120 },
  { key: "powerSource", label: "Compatible power sources", hint: "e.g. USB power bank or USB wall adapter, 5 V / 2 A or more", max: 200 },
  { key: "powerBankIncluded", label: "Power bank included?", choices: { "": "Not confirmed", no: "No — sold separately", yes: "Yes — included" } },
  { key: "batteryCapacity", label: "Included power bank capacity", hint: "Only if a power bank is included, e.g. 10,000 mAh", max: 80 },
  { key: "batteryRuntime", label: "Runtime with the included power bank (manufacturer-tested)", hint: "Only if the manufacturer documents it for the configuration you sell, e.g. about 4 h on low, 2 h on high", max: 200 },
  { key: "cableLength", label: "USB cable length", hint: "e.g. 5 ft (1.5 m)", max: 60 },
  { key: "heatSettings", label: "Heat settings", hint: "e.g. 3 levels (low, medium, high)", max: 120 },
  { key: "heatingZones", label: "Heating zones", hint: "Where the heating elements are, e.g. shoulders and back", max: 160 },
  { key: "temperatureRange", label: "Temperature range (manufacturer data)", hint: "Only from the manufacturer's documentation", max: 120 },
  { key: "warmUpTime", label: "Warm-up time (manufacturer data)", hint: "Only from the manufacturer's documentation", max: 120 },
  { key: "controls", label: "Controls", hint: "e.g. one button on the throw: press to switch levels", max: 200 },
  { key: "autoShutoff", label: "Automatic shut-off", hint: 'e.g. "Yes, after 2 hours" or "No"', max: 120 },
  { key: "inBox", label: "What's in the box", hint: "One item per line, only items really included", max: 600, multiline: true },
  { key: "notIncluded", label: "Not included / optional accessories", hint: "One per line, e.g. USB power bank (sold separately)", max: 400, multiline: true },
  { key: "machineWashable", label: "Machine washable?", choices: { "": "Not confirmed", no: "No", yes: "Yes — per the care label" } },
  { key: "care", label: "Care / cleaning instructions", hint: "Copy them word for word from the care label / manual", max: 1000, multiline: true },
  { key: "manufacturerWarnings", label: "Manufacturer's safety instructions", hint: "Copy them from the manual", max: 2000, multiline: true },
  { key: "handlingTime", label: "Order processing time (before dispatch)", hint: "Confirmed by the supplier, e.g. 1–3 business days", max: 120 },
  { key: "transitTime", label: "Transit time to the US (after dispatch)", hint: "Confirmed by the supplier / carrier, e.g. 5–9 business days", max: 120 },
  { key: "warranty", label: "Warranty", hint: "e.g. 1-year limited warranty from HavenLume", max: 200 },
  { key: "countryOfOrigin", label: "Country of origin", hint: "e.g. Made in China", max: 60 },
  { key: "manualReceived", label: "Manufacturer's manual received?", choices: { "": "Not yet", yes: "Yes — on file" }, internal: true },
  { key: "complianceDocs", label: "Safety & compliance documents on file", hint: "List the documents you actually hold for this exact model (test reports, labels…). Internal only — never shown to customers.", max: 1000, multiline: true, internal: true },
];
const KEY = "product_facts";
const LISTS = ["inBox", "notIncluded"];

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

/** Public view: only confirmed, non-internal values; lists split into lines. */
function publicFacts(facts) {
  const out = {};
  for (const f of FIELDS) {
    if (f.internal || !facts[f.key]) continue;
    out[f.key] = LISTS.includes(f.key) ? facts[f.key].split("\n").map(s => s.trim()).filter(Boolean) : facts[f.key];
  }
  return out;
}

module.exports = { FIELDS, get, save, missing, publicFacts, FactsError };
