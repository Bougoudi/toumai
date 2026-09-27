import type { Metadata } from 'next';
import type { CorridorSummary } from '@touma/contracts';
import { ApiUnavailable, listCorridors, SITE_URL } from '../lib/api';
import { type Langue, alternatesLangues, chemin, nomPays, t } from '../lib/i18n';
import { libelleEnum } from '../lib/libelles';
import { BarreLangue } from './BarreLangue';

/**
 * Liste publique des corridors.
 *
 * Elle sépare en deux ce que la plupart des places de marché confondent : les
 * corridors par lesquels une commande peut réellement passer, et ceux qui sont
 * seulement configurés. Les seconds sont montrés — les cacher ferait croire
 * qu'ils n'existent pas — mais jamais présentés comme ouverts.
 */
export function metaCorridors(langue: Langue): Metadata {
  return {
    title: t(langue, 'corridors.titre'),
    description: t(langue, 'corridors.description'),
    alternates: {
      canonical: `${SITE_URL}${chemin(langue, '/trade')}`,
      languages: alternatesLangues(SITE_URL, '/trade'),
    },
  };
}

function Ligne({ corridor, langue }: { corridor: CorridorSummary; langue: Langue }) {
  const depart = nomPays(langue, corridor.originCountry, corridor.originCountryName);
  const arrivee = nomPays(langue, corridor.destinationCountry, corridor.destinationCountryName);
  return (
    <a className="card" href={chemin(langue, `/trade/${corridor.slug}`)}>
      <h3>
        {depart} → {arrivee}
      </h3>
      <span className="meta">
        {t(langue, 'corridors.statutDeclare', {
          statut: libelleEnum(langue, 'statutCorridor.', corridor.declaredStatus),
        })}
      </span>
      <span className={corridor.operational ? 'badge' : 'badge rupture'}>
        {t(langue, corridor.operational ? 'corridors.operationnel' : 'corridors.pasOperationnel')}
      </span>
    </a>
  );
}

export async function Corridors({ langue }: { langue: Langue }) {
  let corridors: CorridorSummary[] = [];
  try {
    corridors = (await listCorridors()).items;
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <BarreLangue langue={langue} cheminFr="/trade" />
        <h1>{t(langue, 'corridors.titre')}</h1>
        <p className="empty">{t(langue, 'corridors.indisponible')}</p>
      </div>
    );
  }

  const ouverts = corridors.filter((c) => c.operational);
  const autres = corridors.filter((c) => !c.operational);

  return (
    <div className="container">
      <BarreLangue langue={langue} cheminFr="/trade" />
      <h1>{t(langue, 'corridors.titre')}</h1>
      <p className="lede">{t(langue, 'corridors.lede')}</p>

      <h2>{t(langue, 'corridors.ouverts')}</h2>
      {ouverts.length > 0 ? (
        <div className="grid">
          {ouverts.map((c) => (
            <Ligne key={c.id} corridor={c} langue={langue} />
          ))}
        </div>
      ) : (
        <p className="empty">{t(langue, 'corridors.aucunOuvert')}</p>
      )}

      {autres.length > 0 && (
        <>
          <h2 style={{ marginTop: 40 }}>{t(langue, 'corridors.autres')}</h2>
          <div className="grid">
            {autres.map((c) => (
              <Ligne key={c.id} corridor={c} langue={langue} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
