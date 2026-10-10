// Icônes PNG de la place de marché TOUMA, sans dépendance externe.
//
// Trois fichiers, et une raison pour chacun :
//   • icon-192.png / icon-512.png — l'icône « any », avec ses coins arrondis,
//     telle que la posent Android et le bureau ;
//   • icon-maskable-512.png — l'icône « maskable ». Android la recadre dans la
//     forme du lanceur (cercle, goutte, carré arrondi) : le fond doit remplir
//     tout le carré et le dessin tenir dans les 80 % centraux, sinon le système
//     rogne la marque.
//
// Encodeur PNG minimal (RGBA 8 bits) via zlib — le même procédé que
// `make-icons.mjs`, avec la palette TOUMA.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../public/touma/img');

// Palette TOUMA (identique à tokens.css).
const GREEN = [11, 93, 94, 255]; // --touma-green
const ORANGE = [224, 122, 63, 255]; // --touma-orange
const CREAM = [250, 248, 242, 255]; // --touma-cream

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
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtre 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Dessine l'icône.
 *
 * La marque : un « T » crème sur fond vert, posé sur un arc orange qui relie
 * deux points — les deux rives du corridor. Rien de figuratif : à 48 px sur un
 * écran de téléphone, un dessin détaillé devient une tache.
 *
 * @param {number} size    côté en pixels
 * @param {boolean} maskable  fond plein bord à bord et marque réduite
 */
function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };

  const cx = size / 2;
  const cy = size / 2;
  // En « maskable », tout le dessin rentre dans la zone sûre : 80 % du côté.
  const scale = maskable ? 0.78 : 1;
  const corner = maskable ? 0 : size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCorner =
        corner > 0 &&
        ((x < corner && y < corner && (corner - x) ** 2 + (corner - y) ** 2 > corner ** 2) ||
          (x > size - corner && y < corner && (x - (size - corner)) ** 2 + (corner - y) ** 2 > corner ** 2) ||
          (x < corner && y > size - corner && (corner - x) ** 2 + (y - (size - corner)) ** 2 > corner ** 2) ||
          (x > size - corner && y > size - corner && (x - (size - corner)) ** 2 + (y - (size - corner)) ** 2 > corner ** 2));
      if (inCorner) continue;
      set(x, y, GREEN);
    }
  }

  // Arc orange : un pont, ouvert vers le haut, sous la lettre.
  const arcR = size * 0.30 * scale;
  const arcThickness = size * 0.055 * scale;
  const arcCy = cy + size * 0.10 * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - arcCy);
      if (Math.abs(d - arcR) <= arcThickness / 2 && y >= arcCy - size * 0.02) set(x, y, ORANGE);
    }
  }

  // Les deux rives, aux extrémités de l'arc.
  const rivePos = [
    [cx - arcR, arcCy],
    [cx + arcR, arcCy],
  ];
  const riveR = size * 0.055 * scale;
  for (const [rx, ry] of rivePos) {
    for (let y = Math.floor(ry - riveR); y <= Math.ceil(ry + riveR); y++) {
      for (let x = Math.floor(rx - riveR); x <= Math.ceil(rx + riveR); x++) {
        if (Math.hypot(x - rx, y - ry) <= riveR) set(x, y, ORANGE);
      }
    }
  }

  // Lettre « T » crème.
  const barW = size * 0.34 * scale;
  const barH = size * 0.085 * scale;
  const stemW = size * 0.095 * scale;
  const stemH = size * 0.30 * scale;
  const topY = cy - size * 0.20 * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inTopBar = Math.abs(x - cx) <= barW / 2 && y >= topY && y <= topY + barH;
      const inStem = Math.abs(x - cx) <= stemW / 2 && y >= topY && y <= topY + stemH;
      if (inTopBar || inStem) set(x, y, CREAM);
    }
  }

  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, size, draw(size, false));
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), png);
  console.log(`✓ touma/img/icon-${size}.png (${png.length} octets)`);
}
const maskable = encodePng(512, 512, draw(512, true));
writeFileSync(resolve(OUT_DIR, 'icon-maskable-512.png'), maskable);
console.log(`✓ touma/img/icon-maskable-512.png (${maskable.length} octets)`);
