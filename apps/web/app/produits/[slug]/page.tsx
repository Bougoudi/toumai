import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { APP_URL, ApiUnavailable, formatMoney, getProduct } from '../../../lib/api';

export const revalidate = 30;

/**
 * Métadonnées de la fiche produit.
 *
 * C'est ici que se gagne le référencement : un titre, une description et une
 * image propres à ce produit, écrits dans le HTML servi — pas injectés après
 * coup par un script.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const produit = await getProduct(slug);
    const description =
      produit.description?.slice(0, 200) ||
      `${produit.title} — vendu par ${produit.store.name} (${produit.countryCode}) sur TOUMA.`;
    return {
      title: produit.title,
      description,
      openGraph: {
        title: produit.title,
        description,
        type: 'website',
        images: produit.images[0]?.url ? [produit.images[0].url] : undefined,
      },
    };
  } catch {
    return { title: 'Produit introuvable' };
  }
}

export default async function FicheProduit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let produit;
  try {
    produit = await getProduct(slug);
  } catch (err) {
    if (err instanceof ApiUnavailable && /\(404\)/.test(err.message)) notFound();
    throw err;
  }

  return (
    <div className="container">
      <div className="product">
        <div>
          <h1>{produit.title}</h1>
          <p className="meta">
            Vendu par {produit.store.name}
            {produit.store.city ? ` — ${produit.store.city}` : ''} ({produit.countryCode})
          </p>
          {produit.description ? <p>{produit.description}</p> : null}

          <dl className="specs">
            {produit.sku && (
              <>
                <dt>Référence</dt>
                <dd>{produit.sku}</dd>
              </>
            )}
            {produit.brand && (
              <>
                <dt>Marque</dt>
                <dd>{produit.brand}</dd>
              </>
            )}
            <dt>Quantité minimale</dt>
            <dd>{produit.minOrderQty}</dd>
            {produit.weightGrams != null && (
              <>
                <dt>Poids unitaire</dt>
                <dd>{produit.weightGrams} g</dd>
              </>
            )}
            {/* « Origine » désignait ici le pays d'expédition. Les deux sont
                distincts, et c'est l'origine qui fonde un certificat
                d'origine : les confondre sur une fiche publique, c'est
                publier une donnée douanière fausse. */}
            <dt>Expédié depuis</dt>
            <dd>{produit.countryCode}</dd>
            {produit.origin?.countryCode && (
              <>
                <dt>Origine de la marchandise</dt>
                <dd>
                  {produit.origin.countryCode}
                  <br />
                  <span className="meta">
                    {produit.origin.status === 'VERIFIED'
                      ? 'Vérifiée sur pièces par TOUMA.'
                      : produit.origin.status === 'DISPUTED'
                        ? 'Contestée : cette déclaration fait l’objet d’un examen.'
                        : 'Déclarée par le vendeur. TOUMA ne l’a pas vérifiée.'}
                  </span>
                </dd>
              </>
            )}
          </dl>
        </div>

        <aside className="panel">
          <p className="price" style={{ fontSize: '1.6rem' }}>
            {formatMoney(produit.price, produit.currency)}
          </p>
          {produit.compareAtPrice && (
            <p className="meta">
              <s>{formatMoney(produit.compareAtPrice, produit.currency)}</s>
            </p>
          )}
          <p className={produit.inStock ? 'badge' : 'badge rupture'}>
            {produit.inStock ? `En stock (${produit.stock})` : 'Rupture'}
          </p>

          {/* La vitrine ne prend pas de commande : le panier, le paiement et la
              messagerie vivent dans l'application, avec une session. Un tunnel
              d'achat dupliqué ici finirait par diverger du vrai. */}
          <p style={{ marginTop: 16 }}>
            <a className="btn" href={`${APP_URL}/touma/produits/${produit.slug}`}>
              Commander sur TOUMA
            </a>
          </p>
          <p className="meta">
            {/* Dire ce que « vérifié » veut dire, et ce que ça ne veut pas dire. */}
            {produit.store.verificationStatus === 'APPROVED'
              ? 'Vendeur vérifié : ses pièces justificatives ont été contrôlées. Cette vérification ne garantit pas la transaction.'
              : 'Ce vendeur n’a pas encore été vérifié.'}
          </p>
        </aside>
      </div>

      {produit.reviews.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2>Avis</h2>
          {produit.reviews.map((avis) => (
            <article key={avis.id} className="panel" style={{ marginBottom: 12 }}>
              <p className="meta">
                {avis.rating}/5 — {avis.author?.name ?? 'Acheteur'}
              </p>
              {avis.comment ? <p>{avis.comment}</p> : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
