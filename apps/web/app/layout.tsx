import type { Metadata } from 'next';
import { APP_URL, ApiUnavailable, listCorridors, SITE_URL } from '../lib/api';
import './globals.css';

export const metadata: Metadata = {
  // Sans base, Next.js ne peut pas résoudre les URL canoniques ni celles
  // d'OpenGraph, et les émet relatives — ce qu'aucun moteur ne sait recoller.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'TOUMA — place de marché du commerce africain',
    template: '%s — TOUMA',
  },
  description:
    "Acheter et vendre entre pays africains : catalogue, paiement, livraison, appels d'offres et négociation. Corridor pilote Tchad ↔ Cameroun.",
  applicationName: 'TOUMA',
  openGraph: { type: 'website', siteName: 'TOUMA', locale: 'fr_FR' },
};

/**
 * Bandeau de corridor.
 *
 * Il annonçait « Corridor ouvert : Tchad ↔ Cameroun », écrit en dur. C'était
 * faux dès que le corridor était suspendu, et faux depuis toujours tant
 * qu'aucun transporteur réel ne le couvrait : exactement l'affirmation que §72
 * interdit. Il lit maintenant l'état réel, et ne dit rien quand il ne sait pas.
 */
async function bandeauCorridors(): Promise<string | null> {
  try {
    const ouverts = (await listCorridors()).items.filter((c) => c.operational);
    if (ouverts.length === 0) return null;
    return `Corridor${ouverts.length > 1 ? 's' : ''} ouvert${ouverts.length > 1 ? 's' : ''} : ${ouverts
      .map((c) => `${c.originCountryName ?? c.originCountry} → ${c.destinationCountryName ?? c.destinationCountry}`)
      .join(' · ')}`;
  } catch (err) {
    // Une API muette n'autorise pas à annoncer un corridor ouvert.
    if (err instanceof ApiUnavailable) return null;
    throw err;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const bandeau = await bandeauCorridors();

  return (
    <html lang="fr">
      <body>
        <header className="site-header">
          <div className="container">
            <a className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                T
              </span>
              TOUMA
            </a>
            <nav aria-label="Navigation principale">
              <a href="/produits">Catalogue</a>
              <a href="/trade">Corridors</a>
              {/* Tout ce qui demande un compte vit dans l'application, pas ici. */}
              <a href={`${APP_URL}/touma/`}>Mon compte</a>
              <a href={`${APP_URL}/touma/inscription`}>Ouvrir une boutique</a>
            </nav>
          </div>
        </header>
        {bandeau ? <div className="corridor">{bandeau}</div> : null}
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>
              TOUMA — place de marché du commerce africain. Les vendeurs vérifiés ont fourni des justificatifs contrôlés
              par notre équipe ; cette vérification ne constitue pas une garantie de la transaction.
            </p>
            <p>
              <a href={`${APP_URL}/touma/aide`}>Assistance</a> · <a href={`${APP_URL}/api/v1/openapi.json`}>API</a> ·{' '}
              <a href={`${APP_URL}/privacy.html`}>Confidentialité</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
