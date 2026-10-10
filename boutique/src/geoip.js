// IP → country estimate with the free "IP to Country Lite" database by DB-IP.com
// (CC BY 4.0 — attribution "IP Geolocation by DB-IP" is shown in the admin and the
// privacy policy). The lookup happens in memory; the IP address itself is never stored.
// Countries can be wrong: VPNs, proxies, corporate and mobile networks.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const net = require("net");

const state = { loaded: false, source: null, ranges: 0, error: null, v4Starts: null, v4Idx: null, v6Starts: null, v6Idx: null, codes: [] };

function ipv4ToInt(ip) {
  const p = ip.split(".");
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
}

function ipv6Top64(ip) {
  // Expand "::" and return the first 64 bits as a BigInt.
  let [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (t.length && t[t.length - 1].includes(".")) return null; // embedded IPv4: not needed
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  let v = 0n;
  for (let i = 0; i < 4; i++) v = (v << 16n) + BigInt(parseInt(groups[i] || "0", 16));
  return v;
}

/**
 * Parses the DB-IP CSV (start,end,country) straight from a Buffer into pre-allocated typed
 * arrays — no giant string and no per-row objects, so memory stays low (≈ 10 MB).
 */
function loadCsv(input, label) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  const codes = []; const codeIdx = new Map();
  const idx = (cc) => { if (!codeIdx.has(cc)) { codeIdx.set(cc, codes.length); codes.push(cc); } return codeIdx.get(cc); };
  let v4s = new Uint32Array(1 << 16), v4i = new Uint16Array(1 << 16), n4 = 0;
  let v6s = new BigUint64Array(1 << 16), v6i = new Uint16Array(1 << 16), n6 = 0;
  const grow = (a, n) => { const b = new a.constructor(n * 2); b.set(a); return b; };
  let pos = 0;
  while (pos < buf.length) {
    let nl = buf.indexOf(10, pos); if (nl < 0) nl = buf.length;
    const line = buf.toString("latin1", pos, nl); pos = nl + 1;
    const c1 = line.indexOf(","); const c2 = line.indexOf(",", c1 + 1);
    if (c1 < 0 || c2 < 0) continue;
    const start = line.slice(0, c1).replace(/"/g, "");
    const cc = line.slice(c2 + 1).replace(/["\r]/g, "").trim();
    const i = idx(cc === "ZZ" ? "" : cc);
    if (start.includes(":")) {
      const v = ipv6Top64(start);
      if (v === null) continue;
      if (n6 && v6i[n6 - 1] === i) continue;               // merge adjacent ranges
      if (n6 && v6s[n6 - 1] === v) { v6i[n6 - 1] = i; continue; }
      if (n6 === v6s.length) { v6s = grow(v6s, n6); v6i = grow(v6i, n6); }
      v6s[n6] = v; v6i[n6++] = i;
    } else {
      if (n4 && v4i[n4 - 1] === i) continue;
      if (n4 === v4s.length) { v4s = grow(v4s, n4); v4i = grow(v4i, n4); }
      v4s[n4] = ipv4ToInt(start); v4i[n4++] = i;
    }
  }
  state.v4Starts = v4s.slice(0, n4); state.v4Idx = v4i.slice(0, n4);
  state.v6Starts = v6s.slice(0, n6); state.v6Idx = v6i.slice(0, n6);
  state.codes = codes; state.loaded = true; state.source = label; state.ranges = n4 + n6; state.error = null;
}

function loadFile(file) {
  const buf = fs.readFileSync(file);
  loadCsv(file.endsWith(".gz") ? zlib.gunzipSync(buf) : buf, path.basename(file));
}

function search(starts, value) {
  let lo = 0, hi = starts.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= value) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Returns an ISO 3166-1 alpha-2 code, or null when unknown. */
function lookup(ipRaw) {
  if (!state.loaded || !ipRaw) return null;
  let ip = String(ipRaw).trim();
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const i = search(state.v4Starts, ipv4ToInt(ip));
    return i < 0 ? null : state.codes[state.v4Idx[i]] || null;
  }
  if (net.isIPv6(ip)) {
    const v = ipv6Top64(ip);
    if (v === null) return null;
    const i = search(state.v6Starts, v);
    return i < 0 ? null : state.codes[state.v6Idx[i]] || null;
  }
  return null;
}

const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Loads the database from disk, downloading this month's (or last month's) file when it
 * is missing or older than 35 days. Never throws: failures leave countries "Unknown".
 */
async function init(cfg, log = console, fetchImpl = fetch) {
  const file = cfg.geoip.path;
  try {
    const fresh = fs.existsSync(file) && (Date.now() - fs.statSync(file).mtimeMs) < 35 * 86400_000;
    if (!fresh && cfg.geoip.autoDownload) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const now = new Date();
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      let ok = false;
      for (const m of [month(now), month(prev)]) {
        const url = `https://download.db-ip.com/free/dbip-country-lite-${m}.csv.gz`;
        try {
          const r = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          zlib.gunzipSync(buf); // fails on a truncated or invalid archive
          fs.writeFileSync(`${file}.tmp`, buf); fs.renameSync(`${file}.tmp`, file);
          log.log(`GeoIP: downloaded DB-IP country lite ${m}.`);
          ok = true; break;
        } catch { /* try the previous month */ }
      }
      if (!ok && !fs.existsSync(file)) throw new Error("could not download the DB-IP country database");
    }
    if (!fs.existsSync(file)) throw new Error(`GeoIP database not found at ${file}`);
    loadFile(file);
    log.log(`GeoIP: ${state.ranges} ranges loaded (${state.source}).`);
  } catch (err) {
    state.error = String(err.message || err);
    log.warn(`GeoIP unavailable — countries will show as Unknown: ${state.error}`);
  }
  return status();
}

function status() { return { loaded: state.loaded, source: state.source, ranges: state.ranges, error: state.error }; }
function resetForTests() { Object.assign(state, { loaded: false, source: null, ranges: 0, error: null }); }

module.exports = { init, lookup, loadCsv, loadFile, status, resetForTests };
