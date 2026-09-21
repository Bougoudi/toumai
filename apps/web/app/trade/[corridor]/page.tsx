import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CorridorDetail, ProductSummary } from '@touma/contracts';
import { ListeProduits } from '../../../components/ListeProduits';
import { APP_URL, ApiUnavailable, getCorridor, listProducts, SITE_URL } from '../../../lib/api';
import { LIBELLES_DOCUMENT, LIBELLES_STATUT_CORRIDOR, libelle } from '../../../lib/libelles';

/**
 * Page publique d'un corridor : `/trade/tchad-cameroun` (§61).
 *
 * Deux règles gouvernent ce fichier, et elles ne sont pas la même.
 *
 * 1. **Une URL sans corridor configuré rend 404.** On n'écrit pas une page
 *    « Tchad → Nigeria » parce que quelqu'un a tapé l'adresse.
 * 2. **Un corridor configuré mais non opérationnel rend une page, et cette
 *    page n'est pas indexable.** La différence compte : l'information est
 *    utile à qui la cherche — savoir qu'un corridor est annoncé et ce qui lui
 *    manque vaut mieux qu'un 404 — mais l'offrir à l'indexation reviendrait à
 *    faire figurer dans un moteur de recherche un corridor par lequel rien ne
 *    passe. C'est exactement ce que §61 interdit.
 *
 * « Opérationnel » n'est pas « déclaré ouvert » : c'est le serveur qui
 * recalcule, à chaque lecture, si un moyen de paiement et un transporteur réels
 * couvrent les deux pays (§72).
 */

export const revalidate = 60;

/** Charge le corridor, ou rend 404 si l'adresse ne désigne rien. */
async function chargerCorridor(reference: string): Promise<CorridorDetail | null> {
  try {
    return await getCorridor(reference);
  } catch (err) {
    if (err instanceof ApiUnavailable && /\(404\)/.test(err.message)) return null;
    throw err;
  }
}

function titre(corridor: CorridorDetail): string {
  const depart = corridor.originCountryName ?? corridor.originCountry;
  const arrivee = corridor.destinationCountryName ?? corridor.destinationCountry;
  return `Commerce ${depart} → ${arrivee}`;
}

export async function generateMetadata({ params }: { params: Promise<{ corridor: string }> }): Promise<Metadata> {
  const { corridor: reference } = await params;

  let corridor: CorridorDetail | null = null;
  try {
    corridor = await chargerCorridor(reference);
  } catch {
    // L'API est injoignable : pas de métadonnées inventées, et surtout pas
    // d'autorisation d'indexer une page dont on ignore l'état.
    return { title: 'Corridor', robots: { index: false, follow: true } };
  }
  if (!corridor) return { title: 'Corridor introuvable', robots: { index: false, follow: false } };

  const depart = corridor.originCountryName ?? corridor.originCountry;
  const arrivee = corridor.destinationCountryName ?? corridor.destinationCountry;
  const ouvert = corridor.capability.operational;

  // Pas d'article devant un nom de pays : « le Tchad » se dit, « le Côte
  // d'Ivoire » non. Le genre des noms de pays est une règle qu'aucune
  // concaténation ne tient, et une faute d'accord sur une page publique se voit
  // autant qu'une donnée fausse. Les noms sont donc toujours employés nus.
  const description = ouvert
    ? `Acheter et vendre sur le corridor ${depart} → ${arrivee} de TOUMA : moyens de paiement disponibles des deux côtés, transporteurs couvrant le corridor, documents commerciaux et suivi de commande.`
    : `Le corridor ${depart} → ${arrivee} est configuré sur TOUMA mais n’est pas encore opérationnel. Cette page dit ce qui manque pour qu’il le devienne.`;

  const url = `${SITE_URL}/trade/${corridor.slug}`;

  return {
    title: titre(corridor),
    description,
    alternates: { canonical: url },
    // Le cœur de §61 : seul un corridor réellement opérationnel entre dans
    // l'index. `follow` reste vrai — les liens sortants de la page sont bons,
    // c'est la page elle-même qui n'a rien à faire dans les résultats.
    robots: ouvert ? undefined : { index: false, follow: true },
    openGraph: { title: titre(corridor), description, url, type: 'website', locale: 'fr_FR' },
  };
}

/**
 * Données structurées.
 *
 * Émises **uniquement** pour un corridor opérationnel. Un balisage
 * `Service` sur un corridor fermé annoncerait un service rendu à des machines
 * qui ne liront jamais la phrase d'à côté expliquant qu'il ne l'est pas.
 */
function donneesStructurees(corridor: CorridorDetail): string {
  const depart = corridor.originCountryName ?? corridor.originCountry;
  const arrivee = corridor.destinationCountryName ?? corridor.destinationCountry;
  const url = `${SITE_URL}/trade/${corridor.slug}`;

  const graphe: unknown[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TOUMA', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Corridors', item: `${SITE_URL}/trade` },
        { '@type': 'ListItem', position: 3, name: titre(corridor), item: url },
      ],
    },
  ];

  if (corridor.capability.operational) {
    graphe.push({
      '@type': 'Service',
      name: titre(corridor),
      serviceType: 'Place de marché pour le commerce transfrontalier',
      url,
      provider: { '@type': 'Organization', name: 'TOUMA', url: SITE_URL },
      areaServed: [
        { '@type': 'Country', name: depart },
        { '@type': 'Country', name: arrivee },
      ],
      availableChannel: { '@type': 'ServiceChannel', serviceUrl: `${APP_URL}/touma/` },
    });
  }

  // `<` échappé : un nom de pays ne devrait jamais contenir « </script> »,
  // mais une donnée qui traverse un `<script>` sans être échappée est une
  // faille en attente d'un jeu de données inattendu.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graphe }).replace(/</g, '\\u003c');
}

export default async function PageCorridor({ params }: { params: Promise<{ corridor: string }> }) {
  const { corridor: reference } = await params;

  let corridor: CorridorDetail | null;
  try {
    corridor = await chargerCorridor(reference);
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <h1>Corridor</h1>
        <p className="empty">L’état des corridors est momentanément indisponible. Réessayez dans un instant.</p>
      </div>
    );
  }
  if (!corridor) notFound();

  const depart = corridor.originCountryName ?? corridor.originCountry;
  const arrivee = corridor.destinationCountryName ?? corridor.destinationCountry;
  const { capability } = corridor;

  // Des produits réellement en catalogue au départ du pays d'origine. Aucun
  // n'est fabriqué pour remplir la page : s'il n'y en a pas, la page le dit.
  let produits: ProductSummary[] = [];
  try {
    produits = (await listProducts({ country: corridor.originCountry, limit: 8 })).items;
  } catch {
    produits = [];
  }

  return (
    <div className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: donneesStructurees(corridor) }} />

      <h1>{titre(corridor)}</h1>

      <p className="lede">
        {capability.operational
          ? `Les commandes ${depart} → ${arrivee} peuvent être passées : un moyen de paiement et un transporteur couvrent réellement ce corridor.`
          : `Ce corridor est configuré mais n’est pas opérationnel aujourd’hui. Aucune commande ${depart} → ${arrivee} ne peut aboutir tant que les points ci-dessous ne sont pas levés.`}
      </p>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h2>État du corridor</h2>
        {/* Statut déclaré et capacité réelle côte à côte, jamais fondus : le
            premier est une décision d'exploitant, le second un constat. */}
        <dl className="specs">
          <dt>Statut déclaré</dt>
          <dd>{libelle(LIBELLES_STATUT_CORRIDOR, capability.declaredStatus)}</dd>
          <dt>Fonctionne réellement</dt>
          <dd>{capability.operational ? 'oui' : 'non'}</dd>
        </dl>
        {capability.missing.length > 0 && (
          <>
            <h3>Ce qui manque</h3>
            <ul>
              {capability.missing.map((manque) => (
                <li key={manque}>{manque}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Ce qui est disponible</h2>
        <dl className="specs">
          <dt>Moyens de paiement</dt>
          <dd>
            {capability.paymentMethods.length > 0
              ? capability.paymentMethods.join(', ')
              : 'Aucun moyen de paiement n’est disponible des deux côtés de ce corridor.'}
          </dd>
          <dt>Transporteurs</dt>
          <dd>
            {capability.shippingProviders.length > 0
              ? capability.shippingProviders.join(', ')
              : 'Aucun transporteur enregistré ne couvre les deux pays.'}
          </dd>
          <dt>Devises</dt>
          <dd>{capability.currencies.length > 0 ? capability.currencies.join(', ') : 'Aucune devise déclarée.'}</dd>
          <dt>Délai de transit</dt>
          <dd>
            {corridor.estimatedTransitMinDays != null && corridor.estimatedTransitMaxDays != null
              ? `${corridor.estimatedTransitMinDays} à ${corridor.estimatedTransitMaxDays} jours, annoncés par les transporteurs. Ce n’est pas un engagement de TOUMA.`
              : 'Estimation indisponible.'}
          </dd>
        </dl>
      </section>

      {corridor.requiredDocuments.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>Documents attendus</h2>
          <ul>
            {corridor.requiredDocuments.map((kind) => (
              <li key={kind}>{libelle(LIBELLES_DOCUMENT, kind)}</li>
            ))}
          </ul>
          {/* TOUMA n'est ni une douane ni un cabinet de conseil : la liste est
              celle configurée pour ce corridor, pas une règle officielle. */}
          <p className="meta">
            Cette liste est celle configurée pour ce corridor sur TOUMA. Elle ne remplace pas les exigences des
            administrations douanières et fiscales des deux pays, qui font foi.
          </p>
        </section>
      )}

      {corridor.routes.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>Itinéraires</h2>
          <ul>
            {corridor.routes.map((route) => (
              <li key={route.id}>
                {route.name}{' '}
                {route.attributed ? (
                  <span className="meta">
                    — source : {route.sourceUrl ? <a href={route.sourceUrl}>{route.sourceName}</a> : route.sourceName}
                  </span>
                ) : (
                  // Un itinéraire que personne n'affirme ne doit pas ressembler
                  // à un fait établi (§32).
                  <span className="meta">— aucune source déclarée</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2>Produits en catalogue au départ — {depart}</h2>
        {produits.length > 0 ? (
          <>
            <ListeProduits produits={produits} />
            <p style={{ marginTop: 16 }}>
              <a className="btn secondary" href={`/produits?country=${corridor.originCountry}`}>
                Voir tout le catalogue — {depart}
              </a>
            </p>
          </>
        ) : (
          <p className="empty">Aucun produit n’est actuellement en catalogue au départ de ce pays.</p>
        )}
      </section>

      {capability.operational && (
        <p>
          <a className="btn" href={`${APP_URL}/touma/`}>
            Commander sur TOUMA
          </a>
        </p>
      )}
    </div>
  );
}
