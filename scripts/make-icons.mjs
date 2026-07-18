// Génère les icônes PNG de l'application (192 & 512) sans dépendance externe.
// Encodeur PNG minimal (RGBA, 8 bits) via zlib.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/icons');

// Palette (cohérente avec le thème de l'UI)
const BG = [15, 23, 42, 255]; // slate-900
const ACCENT = [34, 211, 238, 255]; // cyan-400
const WHITE = [255, 255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10-12 = compression / filter / interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  const cx = size / 2;
  const cy = size / 2;
  const rCircle = size * 0.34;
  // Bord arrondi du fond (coins) : rayon
  const corner = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Fond avec coins arrondis (sinon transparent)
      const inCorner =
        (x < corner && y < corner && (corner - x) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x > size - corner && y < corner && (x - (size - corner)) ** 2 + (corner - y) ** 2 > corner ** 2) ||
        (x < corner && y > size - corner && (corner - x) ** 2 + (y - (size - corner)) ** 2 > corner ** 2) ||
        (x > size - corner && y > size - corner && (x - (size - corner)) ** 2 + (y - (size - corner)) ** 2 > corner ** 2);
      if (inCorner) continue;
      set(x, y, BG);

      // Disque d'accent
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rCircle) set(x, y, ACCENT);
    }
  }

  // Lettre « T » en blanc, centrée
  const barW = size * 0.30;
  const barH = size * 0.075;
  const stemW = size * 0.085;
  const stemH = size * 0.30;
  const topY = cy - size * 0.13;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inTopBar = Math.abs(x - cx) <= barW / 2 && y >= topY && y <= topY + barH;
      const inStem = Math.abs(x - cx) <= stemW / 2 && y >= topY && y <= topY + stemH;
      if (inTopBar || inStem) set(x, y, WHITE);
    }
  }

  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, size, draw(size));
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), png);
  console.log(`✓ icon-${size}.png (${png.length} octets)`);
}
