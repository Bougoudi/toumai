import { prisma } from '../../../db/prisma.js';

/**
 * INTELLIGENCE DE FRAUDE (§26).
 *
 * V21 évalue déjà **une** transaction, **un** avis, **un** compte. Rien
 * n'assemblait ces évaluations. C'est le seul apport de ce fichier :
 * rapprocher des évaluations existantes pour faire apparaître ce qu'aucune ne
 * montre seule — une boutique dont les commandes sont massivement classées à
 * risque, une salve d'avis signalés en quelques jours, des paiements qui
 * échouent en série sur un même compte.
 *
 * **Ce fichier ne décide de rien**, et c'est la contrainte du §26 :
 * « l'IA ne doit pas être seule responsable d'une décision critique ».
 * Aucune fonction ici ne suspend, ne bloque, ne restreint. Elles produisent
 * une **file de revue humaine**, avec les faits qui l'ont remplie.
 *
 * La confiance rendue n'est pas un pourcentage de certitude : c'est une mesure
 * de l'échantillon. Trois commandes ne disent rien d'une boutique, et le dire
 * vaut mieux que rendre un signal aussi assuré que s'il en portait trois cents.
 */

/** En dessous, aucun signal d'entité n'est produit. */
export const ECHANTILLON_MINIMAL = 5;

export type Confiance = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SignalRisque {
  code: string;
  subjectType: 'STORE' | 'USER' | 'ORDER';
  subjectId: string;
  subjectLabel: string | null;
  /** Ce qui a été mesuré. Des nombres, jamais une conclusion. */
  evidence: Record<string, unknown>;
  confidence: Confiance;
  sampleSize: number;
  /** Ce qu'un humain devrait aller regarder. Jamais ce qu'il devrait décider. */
  recommendedReview: string;
}

/**
 * Confiance déduite du seul échantillon.
 *
 * Volontairement grossière. Une formule fine donnerait une fausse précision à
 * une grandeur qui n'en a pas : « 73 % de confiance » se lirait comme une
 * probabilité de fraude, ce qu'elle n'est pas.
 */
function confiance(echantillon: number): Confiance {
  if (echantillon >= 30) return 'HIGH';
  if (echantillon >= 12) return 'MEDIUM';
  return 'LOW';
}

export const riskInsights = {
  /**
   * Boutiques dont les commandes sont anormalement classées à risque.
   *
   * Le taux est rapporté au volume : une boutique à deux commandes toutes deux
   * classées HIGH afficherait 100 %, et figurerait en tête d'une liste de
   * suspects sans rien avoir fait.
   */
  async storesWithRiskyOrders(days: number, seuilPourcent = 30): Promise<SignalRisque[]> {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const risques = await prisma.toumaTransactionRisk.findMany({
      where: { createdAt: { gte: depuis } },
      select: { level: true, decision: true, order: { select: { storeId: true, store: { select: { name: true } } } } },
    });

    const parBoutique = new Map<string, { nom: string | null; total: number; eleves: number; bloques: number }>();
    for (const r of risques) {
      const id = r.order.storeId;
      const e = parBoutique.get(id) ?? { nom: r.order.store?.name ?? null, total: 0, eleves: 0, bloques: 0 };
      e.total += 1;
      if (r.level === 'HIGH' || r.level === 'CRITICAL') e.eleves += 1;
      if (r.decision !== 'ALLOW') e.bloques += 1;
      parBoutique.set(id, e);
    }

    const signaux: SignalRisque[] = [];
    for (const [id, e] of parBoutique) {
      if (e.total < ECHANTILLON_MINIMAL) continue;
      const taux = (e.eleves / e.total) * 100;
      if (taux < seuilPourcent) continue;
      signaux.push({
        code: 'STORE_HIGH_RISK_ORDER_RATE',
        subjectType: 'STORE',
        subjectId: id,
        subjectLabel: e.nom,
        evidence: { orders: e.total, highOrCritical: e.eleves, ratePercent: Number(taux.toFixed(1)), nonAllowedDecisions: e.bloques, windowDays: days },
        confidence: confiance(e.total),
        sampleSize: e.total,
        recommendedReview:
          'Regarder les facteurs de risque communs à ces commandes. Un taux élevé peut venir du produit vendu, du mode de paiement ou du corridor, et pas du vendeur.',
      });
    }
    return signaux.sort((a, b) => Number(b.evidence.ratePercent) - Number(a.evidence.ratePercent));
  },

  /**
   * Salves d'avis signalés sur une même boutique.
   *
   * Un avis signalé isolé n'est rien. Plusieurs en quelques jours sur la même
   * boutique est un motif — dans un sens comme dans l'autre : avis achetés,
   * ou campagne de dénigrement. L'outil ne tranche pas lequel.
   */
  async reviewBursts(days: number, minimum = 3): Promise<SignalRisque[]> {
    const depuis = new Date(Date.now() - days * 86_400_000);
    // `ALLOW` est le cas ordinaire : seuls les avis réellement signalés
    // comptent. `computedAt` est la date de ce modèle, pas `createdAt`.
    const signales = await prisma.toumaReviewRiskScore.findMany({
      where: { computedAt: { gte: depuis }, action: { in: ['FLAG', 'HOLD', 'REVIEW'] } },
      select: { action: true, score: true, review: { select: { product: { select: { storeId: true, store: { select: { name: true } } } } } } },
    });

    const parBoutique = new Map<string, { nom: string | null; compte: number; scores: number[] }>();
    for (const s of signales) {
      const storeId = s.review.product?.storeId;
      if (!storeId) continue;
      const e = parBoutique.get(storeId) ?? { nom: s.review.product?.store?.name ?? null, compte: 0, scores: [] as number[] };
      e.compte += 1;
      e.scores.push(s.score);
      parBoutique.set(storeId, e);
    }

    return [...parBoutique.entries()]
      .filter(([, e]) => e.compte >= minimum)
      .map(([id, e]) => ({
        code: 'REVIEW_RISK_BURST',
        subjectType: 'STORE' as const,
        subjectId: id,
        subjectLabel: e.nom,
        evidence: {
          flaggedReviews: e.compte,
          averageRiskScore: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
          windowDays: days,
        },
        confidence: confiance(e.compte * 4),
        sampleSize: e.compte,
        recommendedReview:
          'Lire ces avis. Une salve peut être un achat d’avis comme une campagne de dénigrement : les deux produisent le même signal et appellent des suites opposées.',
      }));
  },

  /**
   * Comptes cumulant des événements de fraude et des échecs de paiement.
   *
   * Les deux ensemble, jamais l'un seul : un échec de paiement arrive à tout
   * le monde, et un signal de fraude isolé peut être une fausse alerte.
   */
  async accountsUnderWatch(days: number, limit = 20): Promise<SignalRisque[]> {
    const depuis = new Date(Date.now() - days * 86_400_000);
    const evenements = await prisma.toumaFraudEvent.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: depuis }, userId: { not: null } },
      _count: { _all: true },
      _sum: { weight: true },
    });
    if (evenements.length === 0) return [];

    const ids: string[] = evenements.map((e) => e.userId).filter((v): v is string => v !== null);
    const [echecs, scores] = await Promise.all([
      // L'acheteur est lu directement sur la commande du paiement : grouper par
      // `orderId` obligeait à un second aller-retour, et `orderId` peut être
      // nul, ce qui rendait la liste d'identifiants impossible à typer.
      prisma.toumaPayment.findMany({
        where: { status: 'FAILED', createdAt: { gte: depuis }, order: { buyerId: { in: ids } } },
        select: { order: { select: { buyerId: true } } },
      }),
      prisma.toumaRiskScore.findMany({ where: { userId: { in: ids } }, select: { userId: true, score: true, level: true } }),
    ]);
    const echecsParCompte = new Map<string, number>();
    for (const p of echecs) {
      const acheteur = p.order?.buyerId;
      if (!acheteur) continue;
      echecsParCompte.set(acheteur, (echecsParCompte.get(acheteur) ?? 0) + 1);
    }
    const scorePar = new Map(scores.map((s) => [s.userId, s]));

    return evenements
      .filter((e) => e.userId && (echecsParCompte.get(e.userId) ?? 0) > 0)
      .map((e) => {
        const compte = scorePar.get(e.userId!);
        return {
          code: 'ACCOUNT_FRAUD_SIGNALS_WITH_PAYMENT_FAILURES',
          subjectType: 'USER' as const,
          subjectId: e.userId!,
          // Ni nom ni adresse : une file de revue n'a pas besoin d'identité
          // pour être ouverte, et la mettre là l'exposerait à chaque lecture.
          subjectLabel: null,
          evidence: {
            fraudEvents: e._count._all,
            fraudWeight: e._sum.weight ?? 0,
            failedPayments: echecsParCompte.get(e.userId!) ?? 0,
            accountRiskScore: compte?.score ?? null,
            accountRiskLevel: compte?.level ?? null,
            windowDays: days,
          },
          confidence: confiance(e._count._all * 3),
          sampleSize: e._count._all,
          recommendedReview:
            'Ouvrir le compte et lire les événements dans l’ordre. Un incident de prestataire produit les mêmes échecs qu’une carte testée.',
        };
      })
      .sort((a, b) => Number(b.evidence.fraudWeight) - Number(a.evidence.fraudWeight))
      .slice(0, limit);
  },

  /** File de revue complète, tous signaux confondus. */
  async reviewQueue(days = 30) {
    const [boutiques, avis, comptes] = await Promise.all([
      this.storesWithRiskyOrders(days),
      this.reviewBursts(days),
      this.accountsUnderWatch(days),
    ]);
    const signaux = [...boutiques, ...avis, ...comptes];
    return {
      days,
      signals: signaux,
      total: signaux.length,
      /** Répété à chaque lecture, parce que c'est la règle du §26. */
      disclaimer:
        'Ces signaux sont des rapprochements de faits mesurés, pas des accusations. Aucune décision n’est appliquée : suspension, blocage et restriction restent des décisions humaines, prises après lecture du dossier.',
      ...(signaux.length === 0
        ? { note: `Information non disponible : aucun signal au-dessus des seuils sur ${days} jours.` }
        : {}),
    };
  },
};
