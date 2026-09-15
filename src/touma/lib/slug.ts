import { randomBytes } from 'node:crypto';

/** Transforme un texte en identifiant d'URL (sans accents, minuscules, tirets). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Construit un slug unique : essaie `base`, puis `base-2`, `base-3`… et retombe
 * sur un suffixe aléatoire au-delà d'une poignée de collisions.
 */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || 'touma';
  if (!(await exists(root))) return root;
  for (let i = 2; i <= 20; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}
