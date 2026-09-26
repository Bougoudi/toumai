import type { ProductSummary } from '@touma/contracts';
import { formatMoney } from '../lib/api';
import { type Langue, chemin, t } from '../lib/i18n';

/**
 * Grille de produits, partagée par l'accueil et le catalogue.
 *
 * Composant serveur : aucun JavaScript n'est envoyé au navigateur pour
 * l'afficher. C'est tout l'intérêt de la vitrine.
 *
 * Le titre, le nom de boutique et le prix ne sont pas traduits : ce sont des
 * données saisies par les vendeurs. Seule l'ossature autour d'eux suit la
 * langue de lecture.
 */
export function ListeProduits({ produits, langue }: { produits: ProductSummary[]; langue: Langue }) {
  if (produits.length === 0) return <p className="empty">{t(langue, 'produits.aucun')}</p>;

  return (
    <div className="grid">
      {produits.map((p) => (
        <a className="card" key={p.id} href={chemin(langue, `/produits/${p.slug}`)}>
          <h2>{p.title}</h2>
          {/* Un prix et un code pays se lisent de gauche à droite dans les deux
              langues : `dir="ltr"` évite qu'un chiffre suivi d'un sigle se
              réordonne à l'affichage en arabe. */}
          <span className="price" dir="ltr">
            {formatMoney(p.price, p.currency)}
          </span>
          <span className="meta">
            {p.store.name} · <span dir="ltr">{p.countryCode}</span>
          </span>
          {/* La quantité minimale est une information de premier plan en B2B :
              un prix unitaire sans elle n'engage à rien. */}
          {p.minOrderQty > 1 && <span className="meta">{t(langue, 'produits.quantiteMini', { n: p.minOrderQty })}</span>}
          <span className={p.inStock ? 'badge' : 'badge rupture'}>
            {t(langue, p.inStock ? 'produits.enStock' : 'produits.rupture')}
          </span>
        </a>
      ))}
    </div>
  );
}
