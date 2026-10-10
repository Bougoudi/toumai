import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/api';

/**
 * Règles d'exploration.
 *
 * Le contrôle fin de l'indexation des corridors se fait page par page, dans
 * leurs métadonnées : `robots.txt` ne sait pas si un corridor est opérationnel,
 * et une règle écrite ici serait figée au moment de la compilation alors que
 * l'état d'un corridor change en exploitation.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
