import { prisma } from '../../db/prisma.js';
import { fraicheur, type Fraicheur } from './freshness.js';
import { qualifierPays, type QualificationPays } from './market-country.js';

/**
 * RUPTURES AVEC DEMANDE OBSERVÉE (V29 §8).
 *
 * **Ce que V27 a rendu possible.** Jusqu'au journal de mouvements de stock, on
 * savait qu'un produit était à zéro, jamais **depuis quand**. Or la durée est
 * toute l'information : une rupture de deux heures est un réassort en cours, une
 * rupture de douze jours sur un produit que des acheteurs commandaient est une
 * vente perdue tous les jours depuis douze jours.
 *
 * Le journal donne la date exacte : le dernier mouvement dont `quantityAfter`
 * vaut 0.
 *
 * **La limite, dite plutôt que masquée.** Le journal n'existe que depuis V27.
 * Un produit tombé à zéro avant n'a aucun mouvement, et sa durée est alors
 * `UNKNOWN` — ni zéro, ni « depuis toujours ». Les deux seraient faux, et le
 * second ferait paniquer un vendeur sur un article qu'il a arrêté de vendre il
 * y a six mois.
 *
 * **La demande vient des commandes, pas des recherches.** Les recherches sans
 * résultat sont un signal de demande réel (V23), mais un terme de recherche ne
 * se rattache pas de façon fiable à un produit précis : « sac » peut désigner
 * quarante références. Les rattacher produirait un chiffre à l'air précis et
 * faux. Les lignes de commande, elles, nomment le produit sans ambiguïté.
 */

export type DureeRupture = 'UNKNOWN' | 'KNOWN';

export interface SignalRupture {
  product: { id: string; title: string; slug: string };
  store: { id: string; name: string; countryCode: string };
  /** Marché du vendeur, avec son statut V26 (§43). */
  market: QualificationPays;

  /** Quantité vendable. Zéro par définition de ce signal. */
  stock: number;
  /** Engagé mais pas encore livré : une rupture avec des réservations est pire. */
  reserved: number;

  /** Depuis quand le produit est à zéro, quand le journal le sait. */
  outOfStockSince: string | null;
  outOfStockDays: number | null;
  durationStatus: DureeRupture;

  /** Demande observée sur la fenêtre : lignes de commande, sans ambiguïté. */
  unitsOrdered: number;
  ordersCount: number;
  uniqueBuyers: number;

  /**
   * Sévérité, et elle n'est pas un score.
   *
   * `HIGH_DEMAND_STOCKOUT` n'est posé que si les deux faits sont établis : de la
   * demande observée **et** une durée connue supérieure à un jour. §8 le dit —
   * « seulement si les données le justifient ». Sans durée connue, on ne sait
   * pas si la rupture dure depuis une heure.
   */
  signal: 'HIGH_DEMAND_STOCKOUT' | 'STOCKOUT_WITH_DEMAND' | 'STOCKOUT' | 'STOCKOUT_DURATION_UNKNOWN';
  /** Pourquoi ce signal, en toutes lettres. */
  statement: string;
  freshness: Fraicheur;
}

/** À partir de ce nombre d'unités commandées sur la fenêtre, la demande compte. */
const DEMANDE_PLANCHER = 5;
/** En deçà, une rupture est trop récente pour être un problème. */
const JOURS_PLANCHER = 1;

/**
 * Ruptures de stock des produits actifs, avec leur durée et la demande observée.
 *
 * `maintenant` est injectable : sans cela, un test de durée devrait attendre
 * des jours.
 */
export async function ruptures(options: { days: number; storeId?: string; limit?: number; maintenant?: Date } = { days: 30 }): Promise<{
  items: SignalRupture[];
  windowDays: number;
  note: string;
}> {
  const jours = options.days;
  const maintenant = options.maintenant ?? new Date();
  const depuis = new Date(maintenant.getTime() - jours * 86_400_000);
  const limite = options.limit ?? 50;

  /**
   * Produits actifs dont **tout** le stock vendable est à zéro.
   *
   * Un produit à variantes dont une seule variante manque n'est pas en rupture :
   * c'est la somme qui compte.
   *
   * **Pourquoi une agrégation SQL et non un filtre Prisma.** La version
   * naturelle — `inventory: { every: { quantity: { lte: 0 } } }` — produit un
   * `NOT EXISTS` corrélé évalué pour **chaque** produit actif. Sur la base de
   * test, 26 000 produits : la requête a mis onze secondes et fait dépasser le
   * délai de transaction de créations de produits concurrentes, jusqu'à faire
   * échouer vingt-quatre tests sans rapport. Mesuré, pas supposé — les
   * créations passaient de 50 ms à 11 600 ms.
   *
   * L'agrégation part de la table d'inventaire, indexée sur `productId`, et
   * n'examine chaque ligne qu'une fois. C'est ce que §55 demande : une
   * agrégation, pas un recalcul par page.
   */
  const candidats = options.storeId
    ? await prisma.$queryRaw<Array<{ productId: string }>>`
        SELECT i."productId"
          FROM "touma_inventory" i
          JOIN "touma_products" p ON p."id" = i."productId"
         WHERE p."status" = 'ACTIVE' AND p."storeId" = ${options.storeId}
         GROUP BY i."productId"
        HAVING SUM(i."quantity") <= 0
         LIMIT 500`
    : await prisma.$queryRaw<Array<{ productId: string }>>`
        SELECT i."productId"
          FROM "touma_inventory" i
          JOIN "touma_products" p ON p."id" = i."productId"
         WHERE p."status" = 'ACTIVE'
         GROUP BY i."productId"
        HAVING SUM(i."quantity") <= 0
         LIMIT 500`;

  const enRupture = candidats.length === 0
    ? []
    : await prisma.toumaProduct.findMany({
        where: { id: { in: candidats.map((c) => c.productId) } },
        select: {
          id: true,
          title: true,
          slug: true,
          store: { select: { id: true, name: true, countryCode: true } },
          inventory: { select: { quantity: true, reserved: true } },
        },
      });
  if (enRupture.length === 0) {
    return {
      items: [],
      windowDays: jours,
      note: 'Aucun produit actif n’est en rupture complète. Ce n’est pas une absence de données : la vérification a eu lieu.',
    };
  }

  const ids = enRupture.map((p) => p.id);

  const [demande, acheteurs, passagesAZero] = await Promise.all([
    prisma.toumaOrderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: ids }, createdAt: { gte: depuis } },
      _sum: { quantity: true },
      _count: { _all: true },
    }),
    // Acheteurs distincts : dix unités pour un acheteur et dix pour dix
    // acheteurs ne disent pas la même chose du marché.
    prisma.toumaOrderItem.findMany({
      where: { productId: { in: ids }, createdAt: { gte: depuis } },
      select: { productId: true, order: { select: { buyerId: true } } },
    }),
    /**
     * Le moment exact où chaque produit est tombé à zéro.
     *
     * Le dernier mouvement dont `quantityAfter` vaut 0 : c'est la date de la
     * rupture en cours. Un mouvement ultérieur non nul signifierait que le
     * stock est revenu, et le produit ne serait pas dans cette liste.
     */
    prisma.toumaStockMovement.findMany({
      where: { productId: { in: ids }, quantityAfter: 0 },
      select: { productId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const demandeParProduit = new Map(demande.map((d) => [d.productId!, { units: d._sum.quantity ?? 0, orders: d._count._all }]));
  const acheteursParProduit = new Map<string, Set<string>>();
  for (const ligne of acheteurs) {
    if (!ligne.productId) continue;
    const ensemble = acheteursParProduit.get(ligne.productId) ?? new Set<string>();
    ensemble.add(ligne.order.buyerId);
    acheteursParProduit.set(ligne.productId, ensemble);
  }
  // Trié décroissant : le premier vu par produit est le plus récent.
  const zeroParProduit = new Map<string, Date>();
  for (const m of passagesAZero) if (!zeroParProduit.has(m.productId)) zeroParProduit.set(m.productId, m.createdAt);

  const marches = await qualifierPays(enRupture.map((p) => p.store.countryCode));

  const items: SignalRupture[] = enRupture.map((p) => {
    const d = demandeParProduit.get(p.id) ?? { units: 0, orders: 0 };
    const nbAcheteurs = acheteursParProduit.get(p.id)?.size ?? 0;
    const depuisQuand = zeroParProduit.get(p.id) ?? null;
    const joursRupture = depuisQuand ? Math.floor((maintenant.getTime() - depuisQuand.getTime()) / 86_400_000) : null;
    const reserved = p.inventory.reduce((acc, i) => acc + i.reserved, 0);

    const demandeReelle = d.units >= DEMANDE_PLANCHER;
    let signal: SignalRupture['signal'];
    let phrase: string;

    if (joursRupture === null) {
      // Le journal ne couvre pas cette rupture : elle précède V27. Dire « zéro
      // jour » serait faux, « depuis toujours » aussi — et le second ferait
      // paniquer un vendeur sur un article qu'il a arrêté il y a six mois.
      signal = 'STOCKOUT_DURATION_UNKNOWN';
      phrase =
        `En rupture. La durée est inconnue : aucun mouvement de stock ne la couvre — ` +
        `la rupture précède le journal des mouvements. ` +
        (demandeReelle ? `${d.units} unité(s) commandée(s) sur ${jours} jours malgré tout.` : 'Aucune demande notable observée sur la période.');
    } else if (demandeReelle && joursRupture >= JOURS_PLANCHER) {
      signal = 'HIGH_DEMAND_STOCKOUT';
      phrase =
        `En rupture depuis ${joursRupture} jour(s), avec ${d.units} unité(s) commandée(s) par ` +
        `${nbAcheteurs} acheteur(s) distinct(s) sur ${jours} jours. Chaque jour de rupture est une vente non faite.`;
    } else if (demandeReelle) {
      signal = 'STOCKOUT_WITH_DEMAND';
      phrase = `En rupture depuis moins d’un jour, avec ${d.units} unité(s) commandée(s) sur ${jours} jours. Réassort probablement en cours.`;
    } else {
      signal = 'STOCKOUT';
      phrase = `En rupture depuis ${joursRupture} jour(s). Moins de ${DEMANDE_PLANCHER} unités commandées sur ${jours} jours : la demande observée ne justifie pas une alerte.`;
    }

    return {
      product: { id: p.id, title: p.title, slug: p.slug },
      store: p.store,
      market:
        marches.get(p.store.countryCode.toUpperCase()) ?? {
          countryCode: p.store.countryCode,
          name: null,
          status: 'UNKNOWN' as const,
          operating: false,
          statement: `Pays « ${p.store.countryCode} » absent du référentiel TOUMA.`,
        },
      stock: 0,
      reserved,
      outOfStockSince: depuisQuand?.toISOString() ?? null,
      outOfStockDays: joursRupture,
      durationStatus: depuisQuand ? 'KNOWN' : 'UNKNOWN',
      unitsOrdered: d.units,
      ordersCount: d.orders,
      uniqueBuyers: nbAcheteurs,
      signal,
      statement: phrase,
      freshness: fraicheur(depuisQuand, { windowDays: jours, maintenant }),
    };
  });

  // Les ruptures à forte demande d'abord, puis les plus longues. Un vendeur lit
  // les trois premières lignes.
  const rang = { HIGH_DEMAND_STOCKOUT: 0, STOCKOUT_WITH_DEMAND: 1, STOCKOUT_DURATION_UNKNOWN: 2, STOCKOUT: 3 } as const;
  items.sort((a, b) => rang[a.signal] - rang[b.signal] || (b.outOfStockDays ?? -1) - (a.outOfStockDays ?? -1) || b.unitsOrdered - a.unitsOrdered);

  return {
    items: items.slice(0, limite),
    windowDays: jours,
    note:
      'La durée vient du journal des mouvements de stock ; elle est inconnue pour une rupture antérieure à ce journal. ' +
      'La demande vient des lignes de commande : les recherches sans résultat ne sont pas rattachées à un produit, ' +
      'un terme comme « sac » pouvant désigner des dizaines de références.',
  };
}
