import type { ProductSummary } from '@touma/contracts';
import { ListeProduits } from '../components/ListeProduits';
import { APP_URL, ApiUnavailable, listProducts, SITE_URL } from '../lib/api';
import { type Langue, LOCALE_OG, alternatesLangues, chemin, t } from '../lib/i18n';
import { BarreLangue } from './BarreLangue';
import type { Metadata } from 'next';

/**
 * Accueil de la vitrine.
 *
 * Rendu côté serveur : le catalogue arrive **écrit dans le HTML**. C'est ce qui
 * change tout sur un réseau mobile d'Afrique centrale — la page est lisible
 * avant que le moindre script ne s'exécute — et c'est ce que les moteurs de
 * recherche indexent réellement.
 */
export function metaAccueil(langue: Langue): Metadata {
  return {
    title: t(langue, 'site.titre'),
    description: t(langue, 'site.description'),
    alternates: { canonical: `${SITE_URL}${chemin(langue, '/')}`, languages: alternatesLangues(SITE_URL, '/') },
    openGraph: { type: 'website', siteName: 'TOUMA', locale: LOCALE_OG[langue] },
  };
}

export async function Accueil({ langue }: { langue: Langue }) {
  let produits: ProductSummary[] = [];
  let indisponible = false;
  try {
    produits = (await listProducts({ limit: 8 })).items;
  } catch (err) {
    // L'API est injoignable : la vitrine reste debout et le dit. Une page
    // blanche donnerait l'impression que la place de marché n'existe pas.
    indisponible = err instanceof ApiUnavailable;
  }

  return (
    <div className="container">
      <BarreLangue langue={langue} cheminFr="/" />
      <h1>{t(langue, 'accueil.titre')}</h1>
      <p className="lede">{t(langue, 'accueil.lede')}</p>
      <p>
        <a className="btn" href={chemin(langue, '/produits')}>
          {t(langue, 'accueil.voirCatalogue')}
        </a>{' '}
        <a className="btn secondary" href={`${APP_URL}/touma/inscription`}>
          {t(langue, 'nav.ouvrirBoutique')}
        </a>
      </p>

      <h2 style={{ marginTop: 40 }}>{t(langue, 'accueil.derniersProduits')}</h2>
      {indisponible ? (
        <p className="empty">{t(langue, 'catalogue.indisponible')}</p>
      ) : (
        <ListeProduits produits={produits} langue={langue} />
      )}
    </div>
  );
}
