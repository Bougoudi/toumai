import type { Metadata } from 'next';
import { APP_URL } from '../lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TOUMA — place de marché du commerce africain',
    template: '%s — TOUMA',
  },
  description:
    "Acheter et vendre entre pays africains : catalogue, paiement, livraison, appels d'offres et négociation. Corridor pilote Tchad ↔ Cameroun.",
  applicationName: 'TOUMA',
  openGraph: { type: 'website', siteName: 'TOUMA', locale: 'fr_FR' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
              {/* Tout ce qui demande un compte vit dans l'application, pas ici. */}
              <a href={`${APP_URL}/touma/`}>Mon compte</a>
              <a href={`${APP_URL}/touma/inscription`}>Ouvrir une boutique</a>
            </nav>
          </div>
        </header>
        <div className="corridor">Corridor ouvert : Tchad ↔ Cameroun</div>
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
