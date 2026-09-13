import type { ProductSummary } from '@touma/contracts';
import { ListeProduits } from '../components/ListeProduits';
import { APP_URL, ApiUnavailable, listProducts } from '../lib/api';

/**
 * Accueil de la vitrine.
 *
 * Rendu côté serveur : le catalogue arrive **écrit dans le HTML**. C'est ce qui
 * change tout sur un réseau mobile d'Afrique centrale — la page est lisible
 * avant que le moindre script ne s'exécute — et c'est ce que les moteurs de
 * recherche indexent réellement.
 */
export const revalidate = 30;

export default async function Accueil() {
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
      <h1>Connecter le commerce africain</h1>
      <p className="lede">
        Acheter et vendre entre le Tchad et le Cameroun : catalogue vérifié, paiement encadré, livraison suivie, appels
        d&apos;offres et négociation entre entreprises.
      </p>
      <p>
        <a className="btn" href="/produits">
          Voir le catalogue
        </a>{' '}
        <a className="btn secondary" href={`${APP_URL}/touma/inscription`}>
          Ouvrir une boutique
        </a>
      </p>

      <h2 style={{ marginTop: 40 }}>Derniers produits</h2>
      {indisponible ? (
        <p className="empty">Le catalogue est momentanément indisponible. Réessayez dans un instant.</p>
      ) : (
        <ListeProduits produits={produits} />
      )}
    </div>
  );
}
