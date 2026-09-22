import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { APP_URL, ApiUnavailable, formatMoney, getProduct, SITE_URL } from '../lib/api';
import { type Langue, LOCALE_OG, alternatesLangues, chemin, t } from '../lib/i18n';
import { BarreLangue } from './BarreLangue';

/**
 * Métadonnées de la fiche produit.
 *
 * C'est ici que se gagne le référencement : un titre, une description et une
 * image propres à ce produit, écrits dans le HTML servi — pas injectés après
 * coup par un script.
 */
export async function metaFicheProduit(langue: Langue, params: Promise<{ slug: string }>): Promise<Metadata> {
  const { slug } = await params;
  try {
    const produit = await getProduct(slug);
    const description =
      produit.description?.slice(0, 200) ||
      t(langue, 'fiche.descriptionDefaut', {
        titre: produit.title,
        boutique: produit.store.name,
        pays: produit.countryCode,
      });
    const cheminFr = `/produits/${produit.slug}`;
    return {
      title: produit.title,
      description,
      alternates: {
        canonical: `${SITE_URL}${chemin(langue, cheminFr)}`,
        languages: alternatesLangues(SITE_URL, cheminFr),
      },
      openGraph: {
        title: produit.title,
        description,
        type: 'website',
        locale: LOCALE_OG[langue],
        images: produit.images[0]?.url ? [produit.images[0].url] : undefined,
      },
    };
  } catch {
    return { title: t(langue, 'fiche.introuvable') };
  }
}

/** Statuts d'origine connus. Tout autre valeur est traitée comme « déclarée ». */
function cleOrigine(statut: string): 'fiche.origine.VERIFIED' | 'fiche.origine.DISPUTED' | 'fiche.origine.DECLARED' {
  if (statut === 'VERIFIED') return 'fiche.origine.VERIFIED';
  if (statut === 'DISPUTED') return 'fiche.origine.DISPUTED';
  return 'fiche.origine.DECLARED';
}

export async function FicheProduit({ langue, params }: { langue: Langue; params: Promise<{ slug: string }> }) {
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
      <BarreLangue langue={langue} cheminFr={`/produits/${produit.slug}`} />
      <div className="product">
        <div>
          <h1>{produit.title}</h1>
          <p className="meta">
            {produit.store.city
              ? t(langue, 'fiche.venduParVille', { boutique: produit.store.name, ville: produit.store.city })
              : t(langue, 'fiche.venduPar', { boutique: produit.store.name })}{' '}
            (<span dir="ltr">{produit.countryCode}</span>)
          </p>
          {produit.description ? <p>{produit.description}</p> : null}

          <dl className="specs">
            {produit.sku && (
              <>
                <dt>{t(langue, 'fiche.reference')}</dt>
                <dd dir="ltr">{produit.sku}</dd>
              </>
            )}
            {produit.brand && (
              <>
                <dt>{t(langue, 'fiche.marque')}</dt>
                <dd>{produit.brand}</dd>
              </>
            )}
            <dt>{t(langue, 'fiche.quantiteMinimale')}</dt>
            <dd dir="ltr">{produit.minOrderQty}</dd>
            {produit.weightGrams != null && (
              <>
                <dt>{t(langue, 'fiche.poidsUnitaire')}</dt>
                <dd>{t(langue, 'fiche.grammes', { n: produit.weightGrams })}</dd>
              </>
            )}
            {/* « Origine » désignait ici le pays d'expédition. Les deux sont
                distincts, et c'est l'origine qui fonde un certificat
                d'origine : les confondre sur une fiche publique, c'est
                publier une donnée douanière fausse. */}
            <dt>{t(langue, 'fiche.expedieDepuis')}</dt>
            <dd dir="ltr">{produit.countryCode}</dd>
            {produit.origin?.countryCode && (
              <>
                <dt>{t(langue, 'fiche.origineMarchandise')}</dt>
                <dd>
                  <span dir="ltr">{produit.origin.countryCode}</span>
                  <br />
                  <span className="meta">{t(langue, cleOrigine(produit.origin.status))}</span>
                </dd>
              </>
            )}
          </dl>
        </div>

        <aside className="panel">
          <p className="price" dir="ltr" style={{ fontSize: '1.6rem' }}>
            {formatMoney(produit.price, produit.currency)}
          </p>
          {produit.compareAtPrice && (
            <p className="meta" dir="ltr">
              <s>{formatMoney(produit.compareAtPrice, produit.currency)}</s>
            </p>
          )}
          <p className={produit.inStock ? 'badge' : 'badge rupture'}>
            {produit.inStock
              ? t(langue, 'produits.enStockAvecNombre', { n: produit.stock })
              : t(langue, 'produits.rupture')}
          </p>

          {/* La vitrine ne prend pas de commande : le panier, le paiement et la
              messagerie vivent dans l'application, avec une session. Un tunnel
              d'achat dupliqué ici finirait par diverger du vrai. */}
          <p style={{ marginTop: 16 }}>
            <a className="btn" href={`${APP_URL}/touma/produits/${produit.slug}`}>
              {t(langue, 'fiche.commander')}
            </a>
          </p>
          <p className="meta">
            {/* Dire ce que « vérifié » veut dire, et ce que ça ne veut pas dire. */}
            {t(langue, produit.store.verificationStatus === 'APPROVED' ? 'fiche.vendeurVerifie' : 'fiche.vendeurNonVerifie')}
          </p>
        </aside>
      </div>

      {produit.reviews.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2>{t(langue, 'fiche.avis')}</h2>
          {produit.reviews.map((avis) => (
            <article key={avis.id} className="panel" style={{ marginBottom: 12 }}>
              <p className="meta">
                {t(langue, 'fiche.note', { note: avis.rating, auteur: avis.author?.name ?? t(langue, 'fiche.acheteur') })}
              </p>
              {avis.comment ? <p>{avis.comment}</p> : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
