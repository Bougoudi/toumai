import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CorridorDetail, ProductSummary } from '@touma/contracts';
import { ListeProduits } from '../components/ListeProduits';
import { APP_URL, ApiUnavailable, getCorridor, listProducts, SITE_URL } from '../lib/api';
import { type Langue, LOCALE_OG, alternatesLangues, chemin, nomPays, t } from '../lib/i18n';
import { libelleEnum, motifsBlocage } from '../lib/libelles';
import { BarreLangue } from './BarreLangue';

/**
 * Page publique d'un corridor : `/trade/tchad-cameroun`, `/ar/trade/tchad-cameroun` (§61, §62).
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
 *
 * **Le fragment d'URL est le même dans les deux langues.** `tchad-cameroun` est
 * un identifiant produit par le serveur, pas une phrase : le traduire créerait
 * deux adresses pour un corridor et casserait tout lien déjà partagé.
 */

/** Charge le corridor, ou rend 404 si l'adresse ne désigne rien. */
async function chargerCorridor(reference: string): Promise<CorridorDetail | null> {
  try {
    return await getCorridor(reference);
  } catch (err) {
    if (err instanceof ApiUnavailable && /\(404\)/.test(err.message)) return null;
    throw err;
  }
}

function titre(langue: Langue, corridor: CorridorDetail): string {
  return t(langue, 'corridor.titre', {
    depart: nomPays(langue, corridor.originCountry, corridor.originCountryName),
    arrivee: nomPays(langue, corridor.destinationCountry, corridor.destinationCountryName),
  });
}

export async function metaCorridor(langue: Langue, params: Promise<{ corridor: string }>): Promise<Metadata> {
  const { corridor: reference } = await params;

  let corridor: CorridorDetail | null = null;
  try {
    corridor = await chargerCorridor(reference);
  } catch {
    // L'API est injoignable : pas de métadonnées inventées, et surtout pas
    // d'autorisation d'indexer une page dont on ignore l'état.
    return { title: t(langue, 'corridor.generique'), robots: { index: false, follow: true } };
  }
  if (!corridor) return { title: t(langue, 'corridor.introuvable'), robots: { index: false, follow: false } };

  // Pas d'article devant un nom de pays : « le Tchad » se dit, « le Côte
  // d'Ivoire » non. Le genre des noms de pays est une règle qu'aucune
  // concaténation ne tient, et une faute d'accord sur une page publique se voit
  // autant qu'une donnée fausse. Les noms sont donc toujours employés nus.
  const depart = nomPays(langue, corridor.originCountry, corridor.originCountryName);
  const arrivee = nomPays(langue, corridor.destinationCountry, corridor.destinationCountryName);
  const ouvert = corridor.capability.operational;

  const description = t(langue, ouvert ? 'corridor.descriptionOuvert' : 'corridor.descriptionFerme', {
    depart,
    arrivee,
  });

  const cheminFr = `/trade/${corridor.slug}`;
  const url = `${SITE_URL}${chemin(langue, cheminFr)}`;

  return {
    title: titre(langue, corridor),
    description,
    alternates: { canonical: url, languages: alternatesLangues(SITE_URL, cheminFr) },
    // Le cœur de §61 : seul un corridor réellement opérationnel entre dans
    // l'index. `follow` reste vrai — les liens sortants de la page sont bons,
    // c'est la page elle-même qui n'a rien à faire dans les résultats.
    robots: ouvert ? undefined : { index: false, follow: true },
    openGraph: { title: titre(langue, corridor), description, url, type: 'website', locale: LOCALE_OG[langue] },
  };
}

/**
 * Données structurées.
 *
 * Émises **uniquement** pour un corridor opérationnel. Un balisage
 * `Service` sur un corridor fermé annoncerait un service rendu à des machines
 * qui ne liront jamais la phrase d'à côté expliquant qu'il ne l'est pas.
 */
function donneesStructurees(langue: Langue, corridor: CorridorDetail): string {
  const depart = nomPays(langue, corridor.originCountry, corridor.originCountryName);
  const arrivee = nomPays(langue, corridor.destinationCountry, corridor.destinationCountryName);
  const url = `${SITE_URL}${chemin(langue, `/trade/${corridor.slug}`)}`;

  const graphe: unknown[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TOUMA', item: `${SITE_URL}${chemin(langue, '/')}` },
        {
          '@type': 'ListItem',
          position: 2,
          name: t(langue, 'corridors.titre'),
          item: `${SITE_URL}${chemin(langue, '/trade')}`,
        },
        { '@type': 'ListItem', position: 3, name: titre(langue, corridor), item: url },
      ],
    },
  ];

  if (corridor.capability.operational) {
    graphe.push({
      '@type': 'Service',
      name: titre(langue, corridor),
      serviceType: t(langue, 'corridor.typeService'),
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

export async function Corridor({ langue, params }: { langue: Langue; params: Promise<{ corridor: string }> }) {
  const { corridor: reference } = await params;

  let corridor: CorridorDetail | null;
  try {
    corridor = await chargerCorridor(reference);
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <h1>{t(langue, 'corridor.generique')}</h1>
        <p className="empty">{t(langue, 'corridors.indisponible')}</p>
      </div>
    );
  }
  if (!corridor) notFound();

  const depart = nomPays(langue, corridor.originCountry, corridor.originCountryName);
  const arrivee = nomPays(langue, corridor.destinationCountry, corridor.destinationCountryName);
  const { capability } = corridor;
  const manques = motifsBlocage(langue, capability);

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: donneesStructurees(langue, corridor) }} />

      <BarreLangue langue={langue} cheminFr={`/trade/${corridor.slug}`} />
      <h1>{titre(langue, corridor)}</h1>

      <p className="lede">
        {t(langue, capability.operational ? 'corridor.ledeOuvert' : 'corridor.ledeFerme', { depart, arrivee })}
      </p>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h2>{t(langue, 'corridor.etat')}</h2>
        {/* Statut déclaré et capacité réelle côte à côte, jamais fondus : le
            premier est une décision d'exploitant, le second un constat. */}
        <dl className="specs">
          <dt>{t(langue, 'corridor.statutDeclare')}</dt>
          <dd>{libelleEnum(langue, 'statutCorridor.', capability.declaredStatus)}</dd>
          <dt>{t(langue, 'corridor.fonctionne')}</dt>
          <dd>{t(langue, capability.operational ? 'corridor.oui' : 'corridor.non')}</dd>
        </dl>
        {manques.length > 0 && (
          <>
            <h3>{t(langue, 'corridor.ceQuiManque')}</h3>
            <ul>
              {manques.map((manque) => (
                <li key={manque}>{manque}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t(langue, 'corridor.disponible')}</h2>
        <dl className="specs">
          <dt>{t(langue, 'corridor.moyensPaiement')}</dt>
          <dd>
            {capability.paymentMethods.length > 0 ? (
              // Codes de prestataires : des identifiants, pas du texte à traduire.
              <span dir="ltr">{capability.paymentMethods.join(', ')}</span>
            ) : (
              t(langue, 'corridor.aucunMoyenPaiement')
            )}
          </dd>
          <dt>{t(langue, 'corridor.transporteurs')}</dt>
          <dd>
            {capability.shippingProviders.length > 0 ? (
              <span dir="ltr">{capability.shippingProviders.join(', ')}</span>
            ) : (
              t(langue, 'corridor.aucunTransporteur')
            )}
          </dd>
          <dt>{t(langue, 'corridor.devises')}</dt>
          <dd>
            {capability.currencies.length > 0 ? (
              <span dir="ltr">{capability.currencies.join(', ')}</span>
            ) : (
              t(langue, 'corridor.aucuneDevise')
            )}
          </dd>
          <dt>{t(langue, 'corridor.delaiTransit')}</dt>
          <dd>
            {corridor.estimatedTransitMinDays != null && corridor.estimatedTransitMaxDays != null
              ? t(langue, 'corridor.delaiAnnonce', {
                  min: corridor.estimatedTransitMinDays,
                  max: corridor.estimatedTransitMaxDays,
                })
              : t(langue, 'corridor.estimationIndisponible')}
          </dd>
        </dl>
      </section>

      {corridor.requiredDocuments.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(langue, 'corridor.documents')}</h2>
          <ul>
            {corridor.requiredDocuments.map((kind) => (
              <li key={kind}>{libelleEnum(langue, 'doc.', kind)}</li>
            ))}
          </ul>
          {/* TOUMA n'est ni une douane ni un cabinet de conseil : la liste est
              celle configurée pour ce corridor, pas une règle officielle. */}
          <p className="meta">{t(langue, 'corridor.documentsMention')}</p>
        </section>
      )}

      {corridor.routes.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(langue, 'corridor.itineraires')}</h2>
          <ul>
            {corridor.routes.map((route) => (
              <li key={route.id}>
                {route.name}{' '}
                {route.attributed ? (
                  <span className="meta">
                    {t(langue, 'corridor.sourceLabel')}{' '}
                    {route.sourceUrl ? <a href={route.sourceUrl}>{route.sourceName}</a> : route.sourceName}
                  </span>
                ) : (
                  // Un itinéraire que personne n'affirme ne doit pas ressembler
                  // à un fait établi (§32).
                  <span className="meta">{t(langue, 'corridor.aucuneSource')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2>{t(langue, 'corridor.produitsAuDepart', { pays: depart })}</h2>
        {produits.length > 0 ? (
          <>
            <ListeProduits produits={produits} langue={langue} />
            <p style={{ marginTop: 16 }}>
              <a className="btn secondary" href={`${chemin(langue, '/produits')}?country=${corridor.originCountry}`}>
                {t(langue, 'corridor.voirTout', { pays: depart })}
              </a>
            </p>
          </>
        ) : (
          <p className="empty">{t(langue, 'corridor.aucunProduit')}</p>
        )}
      </section>

      {capability.operational && (
        <p>
          <a className="btn" href={`${APP_URL}/touma/`}>
            {t(langue, 'fiche.commander')}
          </a>
        </p>
      )}
    </div>
  );
}
