import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../lib/notifications.js';
import { PLAFOND_CANDIDATS, ruptures, type SignalRupture } from './stockout.js';

/**
 * SIGNAUX PERSISTÉS, SURVEILLANCE ET ALERTES (V29 §28 à §30, §36, §54).
 *
 * **Le manque.** Les signaux de marché étaient recalculés à chaque lecture.
 * Deux conséquences, et la seconde est la plus fâcheuse :
 *
 * 1. Aucun signal n'avait d'âge. Une rupture apparue ce matin et une rupture
 *    qui dure depuis douze jours portaient le même libellé. La durée déduite du
 *    journal de stock (V27) ne couvrait que les ruptures, et seulement celles
 *    postérieures au journal.
 * 2. Aucune alerte n'était possible sans harceler. Un recalcul horaire aurait
 *    envoyé la même alerte vingt-quatre fois par jour.
 *
 * **Le principe.** On persiste l'**état** du signal, et on notifie une
 * **apparition**, jamais une présence. Un signal ouvert qui reste ouvert ne
 * produit rien de plus qu'une date de dernière observation mise à jour.
 *
 * **Ce qui garantit quoi.**
 *
 * | Invariant | Garanti par |
 * |---|---|
 * | un seul signal ouvert par sujet et par type | `openKey` unique en base |
 * | une alerte au plus par signal et par surveillance | `@@unique([signalId, watchId])` |
 * | aucune clôture sur observation incomplète | `truncated` de `ruptures()` |
 *
 * Les deux premiers sont dans le schéma et non dans ce fichier, délibérément :
 * « vérifier puis écrire » laisse deux passages concurrents du planificateur
 * faire le travail deux fois. Une contrainte, elle, tient.
 *
 * **Ce que ce n'est pas.** Aucune prévision, aucun score, aucun classement de
 * fournisseur. `measured` ne porte que des faits constatés, et l'alerte cite la
 * mesure plutôt que d'en tirer une promesse (§15).
 */

/** Les types de signaux produits aujourd'hui. Aucun autre n'est inventé. */
export const TYPES_SIGNAL = [
  'HIGH_DEMAND_STOCKOUT',
  'STOCKOUT_WITH_DEMAND',
  'STOCKOUT_DURATION_UNKNOWN',
  'STOCKOUT',
] as const;

export type TypeSignal = (typeof TYPES_SIGNAL)[number];

/**
 * Le libellé d'un type de signal, en français.
 *
 * Vérifié sur le serveur : le titre de l'alerte affichait « Sac de riz 50 kg :
 * STOCKOUT ». Le reste des notifications de TOUMA est écrit en français — « Retour
 * TR-12 accepté » — et un code d'énumération dans un titre destiné à un vendeur
 * de N'Djamena n'est pas une information, c'est une fuite d'implémentation.
 *
 * Le code reste dans `data.kind` : un client qui sait traduire les codes (c'est
 * ce que fait l'application pour les motifs de blocage de corridor) y trouve de
 * quoi rendre le libellé dans la langue de lecture.
 */
export const LIBELLES: Record<TypeSignal, string> = {
  HIGH_DEMAND_STOCKOUT: 'rupture avec demande observée',
  STOCKOUT_WITH_DEMAND: 'rupture récente avec demande observée',
  STOCKOUT_DURATION_UNKNOWN: 'rupture de durée inconnue',
  STOCKOUT: 'rupture de stock',
};

/** Le libellé, ou le code lui-même si un type inconnu apparaissait un jour. */
export function libelle(kind: string): string {
  return LIBELLES[kind as TypeSignal] ?? kind;
}

/**
 * La clé qui rend un signal unique **tant qu'il est ouvert**.
 *
 * Le type en fait partie, et ce n'est pas un détail : quand une rupture passe de
 * `STOCKOUT` à `HIGH_DEMAND_STOCKOUT`, la clé change, l'ancien signal est clos
 * et un nouveau s'ouvre. C'est voulu — ce changement de gravité est justement
 * l'événement qu'un vendeur veut apprendre, et le garder dans la même ligne le
 * rendrait invisible.
 */
export function cleOuverte(sujet: 'PRODUCT', sujetId: string, type: string): string {
  return `${sujet}:${sujetId}:${type}`;
}

export interface ResultatReconciliation {
  /** Signaux nouvellement ouverts. */
  raised: number;
  /** Signaux déjà ouverts, dont l'observation a été rafraîchie. */
  refreshed: number;
  /** Signaux clos parce qu'ils ne sont plus observés. */
  resolved: number;
  /**
   * Boutiques dont l'observation était tronquée : **rien n'y a été clos**.
   *
   * Sur une liste coupée par une limite, un signal absent n'est pas un signal
   * disparu — il est peut-être simplement au-delà de la limite. Clore serait
   * affirmer une résolution qu'on n'a pas constatée.
   */
  closureSkipped: string[];
}

/** Ce qu'on retient d'une rupture pour la conserver. Des faits, rien de plus. */
function mesure(r: SignalRupture): Prisma.InputJsonValue {
  return {
    productTitle: r.product.title,
    productSlug: r.product.slug,
    stock: r.stock,
    reserved: r.reserved,
    outOfStockSince: r.outOfStockSince,
    outOfStockDays: r.outOfStockDays,
    durationStatus: r.durationStatus,
    unitsOrdered: r.unitsOrdered,
    ordersCount: r.ordersCount,
    uniqueBuyers: r.uniqueBuyers,
    statement: r.statement,
    freshness: r.freshness.state,
    market: { countryCode: r.market.countryCode, status: r.market.status, operating: r.market.operating },
  };
}

/**
 * Les boutiques à réconcilier.
 *
 * Deux ensembles, et il faut les deux. Celles qui ont un produit actif à stock
 * nul : c'est là que des signaux peuvent naître. Celles qui ont un signal
 * ouvert : c'est là qu'un signal peut mourir. Ne prendre que le premier
 * laisserait ouverts à jamais les signaux d'une boutique réapprovisionnée.
 */
async function boutiquesAExaminer(): Promise<string[]> {
  const [enRupture, avecSignal] = await Promise.all([
    // Le `DISTINCT` est dans la requête et non en mémoire : l'agrégat interne
    // rend une ligne par produit en rupture, et sur un catalogue de dizaines de
    // milliers d'articles les rapatrier pour les dédoublonner ensuite ferait
    // traverser le réseau à des milliers de lignes dont on ne garde que
    // quelques identifiants de boutique.
    prisma.$queryRaw<Array<{ storeId: string }>>`
      SELECT DISTINCT z."storeId"
        FROM (
              SELECT p."storeId", i."productId"
                FROM "touma_inventory" i
                JOIN "touma_products" p ON p."id" = i."productId"
               WHERE p."status" = 'ACTIVE'
               GROUP BY p."storeId", i."productId"
              HAVING SUM(i."quantity") <= 0
             ) z`,
    prisma.toumaMarketSignal.findMany({
      where: { resolvedAt: null },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
  ]);
  return [...new Set([...enRupture.map((r) => r.storeId), ...avecSignal.map((s) => s.storeId)])];
}

/**
 * Aligne les signaux persistés sur ce qui est observé maintenant.
 *
 * Idempotent : deux passages consécutifs sans changement d'inventaire ouvrent
 * zéro signal et n'en closent aucun. C'est ce qui permet de le rejouer, à la
 * main comme depuis le planificateur, sans produire de doublon ni de fausse
 * résolution.
 */
export async function reconcilier(
  options: {
    storeId?: string;
    days?: number;
    maintenant?: Date;
    /**
     * Combien de ruptures examiner par boutique. Par défaut le plafond réel.
     *
     * Abaissable **pour les essais** : la règle « aucune clôture sur
     * observation tronquée » est la plus importante de ce fichier et la seule
     * qu'on ne pourrait pas vérifier autrement — il faudrait cinq cents
     * produits en rupture dans une même boutique pour l'atteindre, et un test
     * qui coûte cela ne serait pas écrit.
     */
    limit?: number;
  } = {},
): Promise<ResultatReconciliation> {
  const maintenant = options.maintenant ?? new Date();
  const jours = options.days ?? 30;
  const plafond = options.limit ?? PLAFOND_CANDIDATS;
  const boutiques = options.storeId ? [options.storeId] : await boutiquesAExaminer();

  const resultat: ResultatReconciliation = { raised: 0, refreshed: 0, resolved: 0, closureSkipped: [] };

  for (const storeId of boutiques) {
    // La limite de sortie est portée au plafond des candidats : on ne veut pas
    // qu'une limite d'affichage décide de ce qui est conservé.
    const observe = await ruptures({ days: jours, storeId, limit: plafond, maintenant });

    const parCle = new Map<string, SignalRupture>();
    for (const r of observe.items) parCle.set(cleOuverte('PRODUCT', r.product.id, r.signal), r);

    const ouverts = await prisma.toumaMarketSignal.findMany({
      where: { storeId, resolvedAt: null },
      select: { id: true, openKey: true },
    });

    for (const [cle, r] of parCle) {
      const existant = ouverts.find((o) => o.openKey === cle);
      if (existant) {
        await prisma.toumaMarketSignal.update({
          where: { id: existant.id },
          data: { measured: mesure(r), observedAt: maintenant, lastSeenAt: maintenant },
        });
        resultat.refreshed += 1;
        continue;
      }
      try {
        await prisma.toumaMarketSignal.create({
          data: {
            kind: r.signal,
            subjectType: 'PRODUCT',
            subjectId: r.product.id,
            storeId,
            measured: mesure(r),
            observedAt: maintenant,
            firstSeenAt: maintenant,
            lastSeenAt: maintenant,
            openKey: cle,
          },
        });
        resultat.raised += 1;
      } catch (err) {
        // Un autre passage a ouvert le même signal entre la lecture et
        // l'écriture : la contrainte a fait son travail, il n'y a rien à
        // rattraper. Toute autre erreur remonte.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          resultat.refreshed += 1;
          continue;
        }
        throw err;
      }
    }

    const disparus = ouverts.filter((o) => o.openKey !== null && !parCle.has(o.openKey));
    if (disparus.length === 0) continue;

    if (observe.truncated) {
      // Observation incomplète : un signal absent de la liste n'est pas un
      // signal disparu. On ne clôt rien, et on le dit.
      resultat.closureSkipped.push(storeId);
      continue;
    }

    const clos = await prisma.toumaMarketSignal.updateMany({
      where: { id: { in: disparus.map((d) => d.id) }, resolvedAt: null },
      // `openKey` repasse à `null` : la place se libère pour un futur signal du
      // même sujet, et plusieurs signaux clos peuvent coexister.
      data: { resolvedAt: maintenant, openKey: null },
    });
    resultat.resolved += clos.count;
  }

  return resultat;
}

export interface ResultatAlertes {
  /** Alertes réellement émises. */
  sent: number;
  /** Signaux ouverts examinés. */
  examined: number;
}

/**
 * Émet les alertes dues, et une seule fois chacune.
 *
 * L'unicité `(signalId, watchId)` est ce qui garantit l'« une seule fois ». On
 * insère **d'abord** la ligne d'alerte, et on ne notifie qu'après : dans
 * l'autre ordre, deux passages concurrents enverraient deux notifications avant
 * qu'aucune ligne n'existe.
 *
 * Une surveillance créée après l'apparition d'un signal reçoit ce signal : on
 * s'abonne à l'état d'un produit, pas à l'instant où il a changé. L'alerte
 * porte donc l'âge du signal, pour qu'une rupture d'un mois ne se lise pas
 * comme une nouvelle.
 */
export async function alerter(options: { maintenant?: Date; limit?: number } = {}): Promise<ResultatAlertes> {
  const maintenant = options.maintenant ?? new Date();
  const signaux = await prisma.toumaMarketSignal.findMany({
    where: { resolvedAt: null },
    orderBy: { firstSeenAt: 'asc' },
    take: options.limit ?? 500,
  });

  /**
   * Les alertes déjà émises, lues d'avance.
   *
   * Sans cela, chaque passage du planificateur tentait l'insertion et laissait
   * la contrainte d'unicité la refuser — ce qui est correct, mais fait écrire à
   * Prisma une ligne `prisma:error` par signal déjà alerté, **à chaque
   * passage**. Vérifié sur le serveur : un chemin parfaitement normal remplissait
   * le journal d'erreurs. Un journal qui crie à l'erreur quand tout va bien
   * apprend à ne plus le lire.
   *
   * La contrainte reste la garantie : ce pré-filtre ne fait qu'éviter le bruit
   * du cas courant, et le `catch` plus bas tient toujours la course entre deux
   * passages simultanés.
   */
  const dejaAlertees = new Set(
    (
      await prisma.toumaMarketAlert.findMany({
        where: { signalId: { in: signaux.map((s) => s.id) } },
        select: { signalId: true, watchId: true },
      })
    ).map((a) => `${a.signalId}:${a.watchId}`),
  );

  let envoyees = 0;

  for (const signal of signaux) {
    const surveillances = await prisma.toumaMarketWatch.findMany({
      where: {
        storeId: signal.storeId,
        // Un vendeur surveille un produit précis, ou toute sa boutique.
        OR: [
          { scope: 'PRODUCT', subjectId: signal.subjectId },
          { scope: 'STORE', subjectId: signal.storeId },
        ],
      },
    });

    for (const surveillance of surveillances) {
      if (surveillance.mutedUntil && surveillance.mutedUntil > maintenant) continue;
      // Liste vide = tous les types. Autrement, seuls ceux demandés.
      if (surveillance.kinds.length > 0 && !surveillance.kinds.includes(signal.kind)) continue;
      if (dejaAlertees.has(`${signal.id}:${surveillance.id}`)) continue;

      try {
        await prisma.toumaMarketAlert.create({
          data: { signalId: signal.id, watchId: surveillance.id, userId: surveillance.userId, sentAt: maintenant },
        });
      } catch (err) {
        // Déjà alerté : c'est le cas normal à chaque passage suivant.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }

      const mesures = (signal.measured ?? {}) as Record<string, unknown>;
      const titre = typeof mesures.productTitle === 'string' ? mesures.productTitle : 'Un produit';

      /**
       * Deux âges cohabitent, et il ne faut pas les confondre.
       *
       * Le constat porte déjà une durée — « en rupture depuis 8 jours », lue
       * dans le journal de stock. L'âge du signal, lui, dit depuis quand TOUMA
       * le suit. Vérifié sur le serveur : la première version ajoutait
       * « Signal observé depuis 0 jour(s) » juste après « en rupture depuis
       * 8 jour(s) », et les deux se lisaient comme une contradiction.
       *
       * On le formule donc comme une date de relevé, jamais comme une durée,
       * et « 0 jour » se dit « aujourd'hui ».
       */
      const jours = Math.max(0, Math.floor((maintenant.getTime() - signal.firstSeenAt.getTime()) / 86_400_000));
      const releve = jours === 0 ? 'Relevé pour la première fois aujourd’hui.' : `Relevé pour la première fois il y a ${jours} jour(s).`;

      await notify({
        userId: surveillance.userId,
        type: 'MARKET_SIGNAL_RAISED',
        title: `${titre} — ${libelle(signal.kind)}`,
        // Le constat, et rien de plus. Pas « vous allez perdre X », pas « ce
        // produit va devenir viral » : §15 l'interdit, et de toute façon aucune
        // donnée ici ne le soutiendrait.
        body:
          (typeof mesures.statement === 'string' ? mesures.statement : 'Signal observé sur ce produit.') + ` ${releve}`,
        data: {
          signalId: signal.id,
          kind: signal.kind,
          subjectType: signal.subjectType,
          subjectId: signal.subjectId,
          storeId: signal.storeId,
          firstSeenAt: signal.firstSeenAt.toISOString(),
          observedAt: signal.observedAt.toISOString(),
        },
      });
      envoyees += 1;
    }
  }

  return { sent: envoyees, examined: signaux.length };
}

/** Réconcilie puis alerte. Employé par le planificateur (§54) et par les tests. */
export async function runMarketSignalsOnce(options: { maintenant?: Date } = {}): Promise<
  ResultatReconciliation & ResultatAlertes
> {
  const reconciliation = await reconcilier({ maintenant: options.maintenant });
  if (reconciliation.closureSkipped.length > 0) {
    logger.warn('Signaux de marché : clôture suspendue sur observation tronquée', {
      stores: reconciliation.closureSkipped.length,
    });
  }
  const alertes = await alerter({ maintenant: options.maintenant });
  return { ...reconciliation, ...alertes };
}
