import { prisma } from '../../../db/prisma.js';

/**
 * INTELLIGENCE DE DEMANDE (§21).
 *
 * Quatre sources réellement disponibles en base : les recherches
 * (`ToumaSearchQuery`), les commandes, les lignes de commande, et les demandes
 * de devis. Les vues produit et les ajouts au panier ne sont pas journalisés
 * dans ce dépôt — ils sont donc **absents**, et nommés comme absents plutôt
 * que remplacés par un signal approchant.
 *
 * La règle qui tient tout : **« les recherches ont augmenté » ne se dit que si
 * les données le montrent.** Deux garde-fous pour cela :
 *
 * - un plancher de volume : passer de 1 à 3 recherches est une hausse de
 *   200 % qui ne veut rien dire ;
 * - une fenêtre précédente de même durée, sinon la comparaison est truquée.
 */

/** En dessous, aucune tendance n'est annoncée. */
export const VOLUME_PLANCHER = 10;

/** Variation à partir de laquelle on parle de hausse ou de baisse. */
const SEUIL_VARIATION = 0.2;

export interface Tendance {
  current: number;
  previous: number;
  /** `null` quand le volume est trop faible pour qu'une variation signifie quoi que ce soit. */
  changePercent: number | null;
  direction: 'UP' | 'DOWN' | 'STABLE' | 'INSUFFICIENT_DATA';
  statement: string;
}

function tendance(courant: number, precedent: number, quoi: string, jours: number): Tendance {
  if (courant + precedent < VOLUME_PLANCHER) {
    return {
      current: courant,
      previous: precedent,
      changePercent: null,
      direction: 'INSUFFICIENT_DATA',
      // Dire « pas assez de données » plutôt qu'annoncer une hausse de 200 %
      // entre une et trois occurrences.
      statement: `Information non disponible : trop peu de ${quoi} sur la période (${courant} contre ${precedent}) pour qu’une variation veuille dire quelque chose.`,
    };
  }
  if (precedent === 0) {
    return {
      current: courant,
      previous: 0,
      changePercent: null,
      direction: 'UP',
      statement: `${courant} ${quoi} sur ${jours} jours, contre aucune sur la période précédente.`,
    };
  }
  const variation = (courant - precedent) / precedent;
  const direction = variation >= SEUIL_VARIATION ? 'UP' : variation <= -SEUIL_VARIATION ? 'DOWN' : 'STABLE';
  const mot = direction === 'UP' ? 'augmenté' : direction === 'DOWN' ? 'diminué' : 'peu varié';
  return {
    current: courant,
    previous: precedent,
    changePercent: Number((variation * 100).toFixed(1)),
    direction,
    statement: `Les ${quoi} ont ${mot} de ${Math.abs(variation * 100).toFixed(0)} % sur ${jours} jours (${precedent} → ${courant}).`,
  };
}

/** Deux fenêtres de même durée, accolées. La seconde sert de comparaison. */
function fenetres(days: number) {
  const fin = new Date();
  const debut = new Date(fin.getTime() - days * 86_400_000);
  const debutPrecedent = new Date(debut.getTime() - days * 86_400_000);
  return { debut, fin, debutPrecedent };
}

export const demandIntelligence = {
  /**
   * Signaux de demande pour un terme de recherche.
   *
   * Le terme est normalisé comme il l'est à l'enregistrement, sans quoi
   * « Pagne » et « pagne » compteraient séparément.
   */
  async forTerm(terme: string, days = 30) {
    const { debut, debutPrecedent } = fenetres(days);
    const normalise = terme.trim().toLowerCase().replace(/\s+/g, ' ');

    const [courant, precedent, sansResultat] = await Promise.all([
      prisma.toumaSearchQuery.count({ where: { term: normalise, createdAt: { gte: debut } } }),
      prisma.toumaSearchQuery.count({ where: { term: normalise, createdAt: { gte: debutPrecedent, lt: debut } } }),
      prisma.toumaSearchQuery.count({ where: { term: normalise, resultCount: 0, createdAt: { gte: debut } } }),
    ]);

    return {
      term: normalise,
      days,
      searches: tendance(courant, precedent, 'recherches', days),
      /** Une recherche sans résultat est le signal le plus utile : la demande
       * existe et le catalogue ne la sert pas. */
      withoutResults: sansResultat,
      unmetShare: courant > 0 ? Number(((sansResultat / courant) * 100).toFixed(1)) : null,
      unavailable: ['les vues produit et les ajouts au panier, qui ne sont pas journalisés dans Touma'],
    };
  },

  /** Signaux de demande pour un produit : ses commandes, sa fenêtre précédente. */
  async forProduct(productId: string, days = 30) {
    const { debut, debutPrecedent } = fenetres(days);
    const produit = await prisma.toumaProduct.findFirst({
      where: { id: productId },
      select: { id: true, title: true, categoryId: true },
    });
    if (!produit) return null;

    const compter = (apres: Date, avant?: Date) =>
      prisma.toumaOrderItem.aggregate({
        where: { productId, order: { createdAt: { gte: apres, ...(avant ? { lt: avant } : {}) }, status: { not: 'CANCELLED' } } },
        _sum: { quantity: true },
        _count: { _all: true },
      });

    const [courant, precedent] = await Promise.all([compter(debut), compter(debutPrecedent, debut)]);
    const q = (r: Awaited<ReturnType<typeof compter>>) => r._sum.quantity ?? 0;

    return {
      product: { id: produit.id, title: produit.title },
      days,
      unitsOrdered: tendance(q(courant), q(precedent), 'unités commandées', days),
      orderLines: { current: courant._count._all, previous: precedent._count._all },
      unavailable: ['les vues produit et les ajouts au panier, qui ne sont pas journalisés dans Touma'],
    };
  },

  /**
   * Termes les plus cherchés, et ceux qui ne rendent rien.
   *
   * Les seconds disent où le catalogue manque — c'est l'information la plus
   * actionnable de tout ce fichier, et elle existait déjà côté administration
   * (`intelligenceService.unmetDemand`). Ici elle est rendue aux outils IA.
   */
  async topTerms(days = 30, limit = 10) {
    const { debut } = fenetres(days);
    const groupes = await prisma.toumaSearchQuery.groupBy({
      by: ['term'],
      where: { createdAt: { gte: debut } },
      _count: { _all: true },
      _sum: { resultCount: true },
      orderBy: { _count: { term: 'desc' } },
      take: limit,
    });
    if (groupes.length === 0) {
      return { days, items: [], note: 'Information non disponible : aucune recherche enregistrée sur la période.' };
    }
    return {
      days,
      items: groupes.map((g) => ({
        term: g.term,
        searches: g._count._all,
        // Somme des résultats rendus : zéro veut dire qu'aucune de ces
        // recherches n'a jamais rien trouvé.
        totalResults: g._sum.resultCount ?? 0,
        neverMatched: (g._sum.resultCount ?? 0) === 0,
      })),
      note: null,
    };
  },
};
