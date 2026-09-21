import type { Metadata } from 'next';
import type { CorridorSummary } from '@touma/contracts';
import { ApiUnavailable, listCorridors, SITE_URL } from '../../lib/api';
import { LIBELLES_STATUT_CORRIDOR, libelle } from '../../lib/libelles';

/**
 * Liste publique des corridors.
 *
 * Elle sépare en deux ce que la plupart des places de marché confondent : les
 * corridors par lesquels une commande peut réellement passer, et ceux qui sont
 * seulement configurés. Les seconds sont montrés — les cacher ferait croire
 * qu'ils n'existent pas — mais jamais présentés comme ouverts.
 */

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Corridors',
  description:
    'Les corridors de commerce transfrontalier ouverts sur TOUMA, et ce qui manque à ceux qui ne le sont pas encore.',
  alternates: { canonical: `${SITE_URL}/trade` },
};

function Ligne({ corridor }: { corridor: CorridorSummary }) {
  const depart = corridor.originCountryName ?? corridor.originCountry;
  const arrivee = corridor.destinationCountryName ?? corridor.destinationCountry;
  return (
    <a className="card" href={`/trade/${corridor.slug}`}>
      <h3>
        {depart} → {arrivee}
      </h3>
      <span className="meta">Statut déclaré : {libelle(LIBELLES_STATUT_CORRIDOR, corridor.declaredStatus)}</span>
      <span className={corridor.operational ? 'badge' : 'badge rupture'}>
        {corridor.operational ? 'Opérationnel' : 'Pas encore opérationnel'}
      </span>
    </a>
  );
}

export default async function PageCorridors() {
  let corridors: CorridorSummary[] = [];
  try {
    corridors = (await listCorridors()).items;
  } catch (err) {
    if (!(err instanceof ApiUnavailable)) throw err;
    return (
      <div className="container">
        <h1>Corridors</h1>
        <p className="empty">L’état des corridors est momentanément indisponible. Réessayez dans un instant.</p>
      </div>
    );
  }

  const ouverts = corridors.filter((c) => c.operational);
  const autres = corridors.filter((c) => !c.operational);

  return (
    <div className="container">
      <h1>Corridors</h1>
      <p className="lede">
        Un corridor n’est opérationnel que si un moyen de paiement et un transporteur le couvrent réellement des deux
        côtés. Le statut déclaré par l’exploitant ne suffit pas, et les deux sont affichés séparément.
      </p>

      <h2>Corridors opérationnels</h2>
      {ouverts.length > 0 ? (
        <div className="grid">
          {ouverts.map((c) => (
            <Ligne key={c.id} corridor={c} />
          ))}
        </div>
      ) : (
        <p className="empty">Aucun corridor n’est opérationnel aujourd’hui.</p>
      )}

      {autres.length > 0 && (
        <>
          <h2 style={{ marginTop: 40 }}>Configurés, pas encore opérationnels</h2>
          <div className="grid">
            {autres.map((c) => (
              <Ligne key={c.id} corridor={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
