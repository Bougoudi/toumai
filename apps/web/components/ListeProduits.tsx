import type { ProductSummary } from '@touma/contracts';
import { formatMoney } from '../lib/api';

/**
 * Grille de produits, partagée par l'accueil et le catalogue.
 *
 * Composant serveur : aucun JavaScript n'est envoyé au navigateur pour
 * l'afficher. C'est tout l'intérêt de la vitrine.
 */
export function ListeProduits({ produits }: { produits: ProductSummary[] }) {
  if (produits.length === 0) return <p className="empty">Aucun produit pour le moment.</p>;

  return (
    <div className="grid">
      {produits.map((p) => (
        <a className="card" key={p.id} href={`/produits/${p.slug}`}>
          <h2>{p.title}</h2>
          <span className="price">{formatMoney(p.price, p.currency)}</span>
          <span className="meta">
            {p.store.name} · {p.countryCode}
          </span>
          {/* La quantité minimale est une information de premier plan en B2B :
              un prix unitaire sans elle n'engage à rien. */}
          {p.minOrderQty > 1 && <span className="meta">à partir de {p.minOrderQty} unités</span>}
          <span className={p.inStock ? 'badge' : 'badge rupture'}>{p.inStock ? 'En stock' : 'Rupture'}</span>
        </a>
      ))}
    </div>
  );
}
