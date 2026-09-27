/**
 * Lecture et écriture de CSV, sans dépendance.
 *
 * Un vendeur qui a deux cents références ne les saisira pas une par une : le
 * tableur est l'outil qu'il a déjà. Ce module doit donc encaisser ce qu'un
 * tableur produit réellement — champs entre guillemets, virgules et retours à
 * la ligne dans les cellules, guillemets doublés, séparateur point-virgule des
 * Excel francophones, BOM UTF-8 — et pas seulement un CSV idéal.
 */

/** Détecte le séparateur réellement employé (virgule ou point-virgule). */
function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  // On compte hors guillemets : « Prix, remise » ne doit pas faire pencher la balance.
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === ',') commas += 1;
    else if (!inQuotes && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

/** Analyse un CSV en lignes de cellules. */
export function parseCsv(input: string): string[][] {
  // Le BOM que produit Excel ferait un premier en-tête introuvable.
  const text = input.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        // Guillemet doublé = guillemet littéral.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Les lignes entièrement vides d'un tableur ne sont pas des données.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Transforme un CSV en objets, à partir de sa ligne d'en-têtes normalisée. */
export function parseCsvObjects(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

/**
 * Normalise un en-tête : accents, casse et espaces varient d'un tableur à
 * l'autre, « Prix de vente » et « prix_de_vente » désignent la même colonne.
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Échappe une cellule pour l'écriture. */
function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Écrit un CSV. Le BOM et le point-virgule sont là pour qu'Excel en français
 * ouvre le fichier correctement du premier coup, sans « assistant d'import ».
 */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escapeCell).join(';')];
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
