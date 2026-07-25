import { parseList } from './scoring.js';

const ATTRS = ['Premium', 'Pro', 'Portable', 'Rechargeable', 'Compact', 'Antidérapant', 'Réutilisable', 'Sans fil'];
const HOOKS = ['Neuf', 'Livraison Rapide', 'Haute Qualité', '2024', 'Vendeur FR'];

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function clip(s: string, max = 80): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Génère des titres optimisés pour annonces marketplace (≤ 80 caractères,
 * mots-clés en tête). Heuristique sans dépendance ; branchez un LLM ici pour
 * un rendu encore meilleur.
 */
export function generateTitles(input: { name: string; keywords?: string; category?: string }): string[] {
  const name = titleCase(input.name.trim());
  const kw = parseList(input.keywords ?? '').map(titleCase);
  const cat = input.category ? titleCase(input.category) : '';
  const a1 = ATTRS[input.name.length % ATTRS.length];
  const a2 = ATTRS[(input.name.length + 3) % ATTRS.length];
  const h1 = HOOKS[input.name.length % HOOKS.length];

  const kwHead = kw.slice(0, 2).join(' ');
  const variants = [
    `${name} ${a1} ${kwHead} ${h1}`,
    `${kwHead} ${name} ${a2} ${cat}`.trim(),
    `${name} ${a1} ${a2} — ${h1}`,
    `${name} ${cat} ${kwHead} ${HOOKS[1]}`.trim(),
    `${a1} ${name} ${kwHead} ${HOOKS[2]}`,
    `${name} ${kwHead} ${a2} ${HOOKS[3]}`,
  ];

  // Nettoyage (espaces multiples), déduplication, clip 80.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    const t = clip(v.replace(/\s+/g, ' ').trim());
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
