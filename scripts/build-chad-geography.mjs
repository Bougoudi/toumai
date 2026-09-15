#!/usr/bin/env node
/**
 * Fabrique le jeu de données géographiques du Tchad à partir des exports
 * GeoNames, et l'écrit dans `prisma/seed-data/chad-geography.tsv`.
 *
 * **Pourquoi un script plutôt qu'un fichier déposé à la main.** Le §58 demande
 * un seed reproductible. Un fichier de 12 000 lignes arrivé sans provenance ne
 * l'est pas : personne ne peut le refaire, ni le mettre à jour, ni vérifier
 * qu'il n'a pas été retouché. Ici, la transformation est écrite, la source est
 * nommée, et le résultat se régénère.
 *
 * **Ce que ce script ne fait pas, délibérément.** Il ne comble aucun trou. Les
 * localités que GeoNames ne rattache à aucun département sortent sans
 * département ; les sous-préfectures, absentes de la source, ne sont pas
 * fabriquées. Inventer la subdivision administrative d'un État pour remplir une
 * colonne serait une donnée fausse présentée comme officielle — exactement ce
 * que le §58 interdit. Les limites sont écrites dans
 * `docs/chad-geography-sources.md`.
 *
 * Usage :
 *
 *   mkdir -p /tmp/geonames && cd /tmp/geonames
 *   curl -O https://download.geonames.org/export/dump/TD.zip
 *   curl -O https://download.geonames.org/export/dump/alternatenames/TD.zip   # dans un sous-dossier
 *   curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   curl -O https://download.geonames.org/export/dump/admin2Codes.txt
 *   node scripts/build-chad-geography.mjs --geonames /tmp/geonames
 *
 * Source : GeoNames (https://www.geonames.org), licence CC BY 4.0.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--geonames');
if (dirIndex === -1 || !args[dirIndex + 1]) {
  console.error('Usage : node scripts/build-chad-geography.mjs --geonames <dossier>');
  console.error('Le dossier doit contenir geo/TD.txt, alt/TD.txt, admin1CodesASCII.txt, admin2Codes.txt.');
  process.exit(2);
}
const base = args[dirIndex + 1];
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'prisma/seed-data/chad-geography.tsv';

const lines = (path) =>
  readFileSync(join(base, path), 'utf8')
    .split('\n')
    .filter((l) => l.length > 0 && !l.startsWith('#'));

// ── Noms arabes : uniquement ceux que la source étiquette « ar » ─────────────
// La colonne « alternatenames » du fichier principal mélange toutes les
// variantes sans langue. Y choisir « le premier mot en écriture arabe »
// donnerait une translittération au hasard promue au rang de nom officiel. Le
// fichier des noms alternatifs, lui, porte le code de langue : on ne retient
// que ce qu'il affirme.
const arabic = new Map();
for (const line of lines('alt/TD.txt')) {
  const [, geonameId, lang, name, preferred] = line.split('\t');
  if (lang !== 'ar' || !name) continue;
  // Un nom marqué « préféré » l'emporte sur un nom déjà retenu.
  if (preferred === '1' || !arabic.has(geonameId)) arabic.set(geonameId, name);
}

// ── Provinces (ADM1) ────────────────────────────────────────────────────────
const provinces = [];
for (const line of lines('admin1CodesASCII.txt')) {
  const [code, name, , geonameId] = line.split('\t');
  if (!code.startsWith('TD.')) continue;
  provinces.push({ code: code.slice(3), name, geonameId, nameAr: arabic.get(geonameId) ?? '' });
}

// ── Départements (ADM2) ─────────────────────────────────────────────────────
const departments = [];
for (const line of lines('admin2Codes.txt')) {
  const [code, name, , geonameId] = line.split('\t');
  if (!code.startsWith('TD.')) continue;
  const [, provinceCode, departmentCode] = code.split('.');
  departments.push({
    code: departmentCode,
    provinceCode,
    name,
    geonameId,
    nameAr: arabic.get(geonameId) ?? '',
  });
}

// ── Localités (classe P : lieux habités) ────────────────────────────────────
/**
 * Correspondance des codes GeoNames vers le type demandé par le §4. Elle est
 * volontairement prudente : GeoNames distingue la capitale (PPLC), les
 * chefs-lieux (PPLA) et le reste (PPL), mais ne dit pas si un PPL est une ville
 * ou un village. Tout ce qui n'est pas explicitement l'un des deux premiers est
 * rendu en LOCALITY plutôt qu'affirmé « VILLAGE » ou « TOWN ».
 */
const TYPE_BY_FEATURE = {
  PPLC: 'CITY', // capitale nationale
  PPLA: 'CITY', // chef-lieu de province
  PPLA2: 'TOWN', // chef-lieu de département
  PPLA3: 'TOWN',
  PPLX: 'DISTRICT', // section d'une ville — les arrondissements de N'Djamena
  PPLF: 'RURAL_AREA', // hameau agricole
  PPLQ: 'LOCALITY', // lieu abandonné : gardé, mais jamais promu « ville »
};

const localities = [];
for (const line of lines('geo/TD.txt')) {
  const f = line.split('\t');
  const [geonameId, name, , , lat, lon, featureClass, featureCode] = f;
  if (featureClass !== 'P') continue;
  const provinceCode = f[10];
  const departmentCode = f[11];
  const population = Number(f[14] || 0);
  if (!provinceCode) continue; // sans province, la localité n'est rattachable à rien

  localities.push({
    geonameId,
    name,
    nameAr: arabic.get(geonameId) ?? '',
    provinceCode,
    // Presque toujours vide dans la source : voir docs/chad-geography-sources.md.
    departmentCode: departmentCode ?? '',
    type: TYPE_BY_FEATURE[featureCode] ?? 'LOCALITY',
    latitude: lat ?? '',
    longitude: lon ?? '',
    // 0 signifie « inconnu » chez GeoNames, pas « personne n'y habite ».
    population: population > 0 ? String(population) : '',
  });
}

// ── Écriture ────────────────────────────────────────────────────────────────
// TSV plutôt que JSON : lisible en diff, trié, et sans guillemets à échapper.
const rows = [
  ['# source', 'GeoNames (https://www.geonames.org) — CC BY 4.0'].join('\t'),
  ['# généré par', 'scripts/build-chad-geography.mjs'].join('\t'),
  ['# colonnes', 'kind puis champs propres au niveau — voir docs/chad-geography-sources.md'].join('\t'),
];

for (const p of provinces.sort((a, b) => a.code.localeCompare(b.code))) {
  rows.push(['P', p.code, p.name, p.nameAr, p.geonameId].join('\t'));
}
for (const d of departments.sort((a, b) => (a.provinceCode + a.code).localeCompare(b.provinceCode + b.code))) {
  rows.push(['D', d.code, d.provinceCode, d.name, d.nameAr, d.geonameId].join('\t'));
}
for (const l of localities.sort((a, b) => Number(a.geonameId) - Number(b.geonameId))) {
  rows.push(
    ['L', l.geonameId, l.provinceCode, l.departmentCode, l.name, l.nameAr, l.type, l.latitude, l.longitude, l.population].join('\t'),
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, rows.join('\n') + '\n', 'utf8');

console.log(`${provinces.length} provinces, ${departments.length} départements, ${localities.length} localités → ${out}`);
const sansDepartement = localities.filter((l) => !l.departmentCode).length;
console.log(`Localités sans département dans la source : ${sansDepartement} (laissées sans rattachement, jamais devinées).`);
