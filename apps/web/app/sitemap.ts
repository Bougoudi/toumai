import type { MetadataRoute } from 'next';
import { ApiUnavailable, listCorridors, SITE_URL } from '../lib/api';
import { LANGUES, chemin } from '../lib/i18n';

/**
 * Plan du site.
 *
 * Seuls les corridors **réellement opérationnels** y figurent (§61). Un
 * corridor configuré mais non desservi reste accessible à qui connaît son
 * adresse et porte alors un `noindex` ; il n'est pas proposé à l'indexation.
 *
 * Chaque page y figure **dans les deux langues** (§62), et chaque entrée
 * déclare ses équivalents par `alternates.languages`. Ne lister que le
 * français reviendrait à publier une vitrine arabe que rien n'indique à un
 * moteur — elle existerait sans être trouvable, ce qui est à peu près le
 * contraire du but.
 *
 * L'API injoignable ne vide pas le plan des pages fixes : on publie ce qu'on
 * sait, sans rien deviner sur ce qu'on ignore.
 */
export const revalidate = 300;

/** Une entrée par langue, chacune déclarant les autres. */
function entrees(
  cheminFr: string,
  changeFrequency: 'daily' | 'weekly',
  priority: number,
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(LANGUES.map((l) => [l, `${SITE_URL}${chemin(l, cheminFr)}`]));
  return LANGUES.map((langue) => ({
    url: `${SITE_URL}${chemin(langue, cheminFr)}`,
    changeFrequency,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixes: MetadataRoute.Sitemap = [
    ...entrees('/', 'daily', 1),
    ...entrees('/produits', 'daily', 0.8),
    ...entrees('/trade', 'weekly', 0.6),
  ];

  try {
    const { items } = await listCorridors();
    return [...fixes, ...items.filter((c) => c.operational).flatMap((c) => entrees(`/trade/${c.slug}`, 'weekly', 0.7))];
  } catch (err) {
    if (err instanceof ApiUnavailable) return fixes;
    throw err;
  }
}
