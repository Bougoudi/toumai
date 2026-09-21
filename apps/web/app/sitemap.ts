import type { MetadataRoute } from 'next';
import { ApiUnavailable, listCorridors, SITE_URL } from '../lib/api';

/**
 * Plan du site.
 *
 * Seuls les corridors **réellement opérationnels** y figurent (§61). Un
 * corridor configuré mais non desservi reste accessible à qui connaît son
 * adresse et porte alors un `noindex` ; il n'est pas proposé à l'indexation.
 *
 * L'API injoignable ne vide pas le plan des pages fixes : on publie ce qu'on
 * sait, sans rien deviner sur ce qu'on ignore.
 */
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/produits`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/trade`, changeFrequency: 'weekly', priority: 0.6 },
  ];

  try {
    const { items } = await listCorridors();
    return [
      ...fixes,
      ...items
        .filter((c) => c.operational)
        .map((c) => ({ url: `${SITE_URL}/trade/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ];
  } catch (err) {
    if (err instanceof ApiUnavailable) return fixes;
    throw err;
  }
}
