/**
 * Générateur de contenu produit (titre, description, SKU, tags).
 *
 * Implémentation heuristique sans dépendance externe. Pour un rendu plus
 * riche, branchez ici un LLM (ex: Claude via l'API Anthropic) en gardant la
 * même signature.
 */
const BENEFITS = [
  'Gagnez du temps au quotidien',
  'Qualité durable et finition soignée',
  'Design pensé pour un usage simple',
  'Compact et facile à ranger',
  'Satisfait ou remboursé',
];

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

export function generateSku(category: string, title: string): string {
  const prefix = category.slice(0, 4).toUpperCase();
  const body = slugify(title).replace(/-/g, '').slice(0, 8).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${body}-${rand}`;
}

export function generateDescription(title: string, niche?: string | null): string {
  const picks = [...BENEFITS].sort(() => Math.random() - 0.5).slice(0, 3);
  const nichePart = niche ? ` Idéal pour l'univers « ${niche} ».` : '';
  return (
    `${title} — la solution tendance du moment.${nichePart}\n\n` +
    `Points forts :\n` +
    picks.map((b) => `• ${b}`).join('\n') +
    `\n\nCommandez aujourd'hui, expédition rapide depuis nos fournisseurs partenaires.`
  );
}

/** Génère des URLs d'images placeholder (à remplacer par un vrai fournisseur d'images). */
export function generateImages(title: string, count = 3): string {
  const seed = slugify(title);
  return Array.from({ length: count }, (_, i) => `https://picsum.photos/seed/${seed}-${i}/800/800`).join(',');
}
