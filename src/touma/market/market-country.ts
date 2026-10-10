import type { CountryStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * UN SIGNAL GÉOGRAPHIQUE PORTE LE STATUT DE SON MARCHÉ (V29 §43).
 *
 * **Le défaut corrigé.** L'analyse de la demande agrégeait par pays et rendait
 * un code brut — `{ countryCode: 'NG', searches: 14 }`. Rien ne distinguait le
 * Tchad, où TOUMA opère réellement, du Nigeria, qui est `PLANNED` : aucune
 * géographie chargée, aucun prestataire, aucun corridor. Les deux arrivaient
 * côte à côte dans la même liste, et un lecteur en concluait naturellement que
 * les deux étaient des marchés.
 *
 * Quatorze recherches depuis le Nigeria sont une information réelle — quelqu'un
 * cherche —, mais ce n'est pas de l'activité de marché : c'est de l'intérêt
 * dans un pays où rien ne peut aboutir. Confondre les deux fait prendre une
 * demande non servable pour une demande servie.
 *
 * Ce module n'écarte donc rien. Il **qualifie** : chaque ligne géographique
 * porte le statut V26 de son pays et dit si ce marché accepte des commandes
 * aujourd'hui. Masquer aurait été l'autre erreur — un pays d'où l'on cherche
 * sans pouvoir acheter est précisément ce qu'une équipe d'expansion doit voir.
 */

/** Statuts où le marché accepte réellement des transactions (V26). */
const STATUTS_OUVERTS: ReadonlySet<CountryStatus> = new Set<CountryStatus>(['PILOT', 'ACTIVE', 'LIMITED']);

export interface QualificationPays {
  countryCode: string;
  name: string | null;
  status: CountryStatus | 'UNKNOWN';
  /** Ce marché accepte-t-il des commandes aujourd'hui ? */
  operating: boolean;
  /** Comment lire un signal venant de ce pays. Toujours renseigné. */
  statement: string;
}

/**
 * Qualifie une liste de codes pays en une seule requête.
 *
 * Une par pays aurait rendu l'écran plus lent à mesure que TOUMA s'étend —
 * c'est-à-dire précisément quand cet écran devient utile.
 */
export async function qualifierPays(codes: readonly string[]): Promise<Map<string, QualificationPays>> {
  const uniques = [...new Set(codes.map((c) => c.toUpperCase()).filter(Boolean))];
  if (uniques.length === 0) return new Map();

  const pays = await prisma.country.findMany({
    where: { code: { in: uniques } },
    select: { code: true, name: true, status: true, buyingEnabled: true, active: true },
  });
  const connus = new Map(pays.map((p) => [p.code, p]));

  const sortie = new Map<string, QualificationPays>();
  for (const code of uniques) {
    const p = connus.get(code);
    if (!p) {
      sortie.set(code, {
        countryCode: code,
        name: null,
        status: 'UNKNOWN',
        operating: false,
        // Un code pays absent du référentiel n'est pas un marché fermé : c'est
        // un code qu'on ne reconnaît pas, et il faut le dire comme tel.
        statement: `Pays « ${code} » absent du référentiel TOUMA : ce signal ne peut pas être rattaché à un marché.`,
      });
      continue;
    }

    const ouvert = p.active && p.buyingEnabled && STATUTS_OUVERTS.has(p.status);
    sortie.set(code, {
      countryCode: code,
      name: p.name,
      status: p.status,
      operating: ouvert,
      statement: ouvert
        ? `${p.name} est un marché ouvert (${p.status}) : ce signal est de l’activité commerciale.`
        : `${p.name} n’accepte pas de commandes (${p.status}) : ce signal traduit un intérêt, pas de l’activité de marché — rien ne peut y aboutir aujourd’hui.`,
    });
  }
  return sortie;
}

/**
 * Attache la qualification à chaque ligne d'une agrégation géographique.
 *
 * Le champ s'appelle `market` et non `country` : il ne dit pas *quel* pays,
 * il dit *ce que vaut* ce pays comme marché. La nuance est tout l'objet du
 * module.
 */
export async function qualifierLignes<T extends { countryCode: string }>(
  lignes: readonly T[],
): Promise<Array<T & { market: QualificationPays }>> {
  const qualifications = await qualifierPays(lignes.map((l) => l.countryCode));
  return lignes.map((ligne) => ({
    ...ligne,
    market:
      qualifications.get(ligne.countryCode.toUpperCase()) ?? {
        countryCode: ligne.countryCode,
        name: null,
        status: 'UNKNOWN' as const,
        operating: false,
        statement: `Pays « ${ligne.countryCode} » absent du référentiel TOUMA.`,
      },
  }));
}
