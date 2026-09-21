import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { corridorService } from './corridor.service.js';
import { trustService } from '../trust/trust.service.js';

/**
 * RISQUE TRANSFRONTALIER (§43).
 *
 * « Les décisions critiques nécessitent une logique explicable. » C'est la
 * phrase qui dicte tout ce fichier : chaque signal porte son **poids** et son
 * **fait**, et l'action se déduit d'un seuil affiché. Rien n'est appris, rien
 * n'est opaque, et un vendeur à qui l'on demande un document peut savoir
 * pourquoi.
 *
 * Quatre actions, dans cet ordre de sévérité :
 *
 *   ALLOW            — laisser passer.
 *   REVIEW           — un humain regarde avant.
 *   REQUIRE_DOCUMENT — un document est demandé avant expédition.
 *   HOLD             — rien ne part sans décision humaine.
 *
 * `HOLD` n'est jamais prononcé par ce fichier seul : il est **proposé**, et
 * c'est un humain qui l'applique. Bloquer une marchandise sur un score
 * arrêterait le commerce de quelqu'un sur une addition de pondérations.
 */

export type ActionRisque = 'ALLOW' | 'REVIEW' | 'REQUIRE_DOCUMENT' | 'HOLD';

export interface SignalCommercial {
  code: string;
  weight: number;
  /** Le fait mesuré. Pas une interprétation. */
  evidence: string;
}

export interface EvaluationRisque {
  score: number;
  recommendedAction: ActionRisque;
  signals: SignalCommercial[];
  /** Ce qui n'a pas pu être mesuré. Un signal absent ne vaut pas zéro risque. */
  unmeasured: string[];
  explanation: string;
  disclaimer: string;
}

/**
 * Poids des signaux.
 *
 * Exposés, pas cachés dans le code : un vendeur doit pouvoir lire pourquoi on
 * lui demande un document. Les valeurs sont des choix d'exploitation, pas des
 * vérités — elles se discutent.
 */
export const POIDS_SIGNAUX: Record<string, { weight: number; label: string }> = {
  NEW_CORRIDOR: { weight: 10, label: 'Corridor ouvert depuis moins de 30 jours' },
  LARGE_TRANSACTION: { weight: 20, label: 'Montant très au-dessus de l’habituel sur ce corridor' },
  UNVERIFIED_SELLER: { weight: 25, label: 'Vendeur non vérifié' },
  LOW_SELLER_TRUST: { weight: 20, label: 'Niveau de confiance vendeur faible' },
  NO_ORIGIN_DECLARED: { weight: 10, label: 'Pays d’origine de la marchandise non déclaré' },
  DOCUMENT_INCONSISTENCY: { weight: 25, label: 'Document rejeté ou expiré sur cette commande' },
  PAYMENT_ANOMALY: { weight: 20, label: 'Échec de paiement répété sur cette commande' },
  SHIPPING_ANOMALY: { weight: 15, label: 'Incident d’acheminement non résolu' },
};

/** Seuils, affichés avec le résultat. */
export const SEUILS: Array<{ action: ActionRisque; min: number }> = [
  { action: 'HOLD', min: 70 },
  { action: 'REQUIRE_DOCUMENT', min: 45 },
  { action: 'REVIEW', min: 25 },
  { action: 'ALLOW', min: 0 },
];

function actionPour(score: number): ActionRisque {
  return SEUILS.find((s) => score >= s.min)!.action;
}

export const tradeRiskService = {
  /**
   * Évalue une commande transfrontalière.
   *
   * Lit ce qui existe — confiance V21, paiements, documents, incidents — et
   * n'écrit rien. L'évaluation est une lecture ; c'est l'humain qui agit.
   */
  async assess(tradeOrderId: string): Promise<EvaluationRisque> {
    const t = await prisma.toumaTradeOrder.findUnique({
      where: { id: tradeOrderId },
      include: {
        corridor: true,
        documents: { select: { status: true, kind: true, expiresAt: true } },
        exceptions: { where: { resolvedAt: null }, select: { id: true, kind: true } },
        order: {
          select: {
            id: true,
            total: true,
            currency: true,
            storeId: true,
            buyerCountry: true,
            sellerCountry: true,
            payments: { select: { status: true } },
            store: { select: { id: true, verificationStatus: true, countryCode: true } },
            items: { select: { product: { select: { countryOfOrigin: true, originStatus: true } } } },
          },
        },
      },
    });
    if (!t) throw new Error('Commande transfrontalière introuvable.');

    const signaux: SignalCommercial[] = [];
    const nonMesures: string[] = [];

    // ── Corridor récent ────────────────────────────────────────────────────
    if (t.corridor) {
      const age = (Date.now() - t.corridor.createdAt.getTime()) / 86_400_000;
      if (age < 30) {
        signaux.push({ code: 'NEW_CORRIDOR', weight: POIDS_SIGNAUX.NEW_CORRIDOR.weight, evidence: `Corridor ${t.corridor.code} ouvert il y a ${Math.floor(age)} jour(s).` });
      }
    }

    // ── Vérification du vendeur ────────────────────────────────────────────
    if (t.order.store.verificationStatus !== 'APPROVED') {
      signaux.push({ code: 'UNVERIFIED_SELLER', weight: POIDS_SIGNAUX.UNVERIFIED_SELLER.weight, evidence: `Statut de vérification : ${t.order.store.verificationStatus}.` });
    }

    // ── Confiance V21 ──────────────────────────────────────────────────────
    const confiance = await trustService.get('SELLER', t.order.store.id).catch(() => null);
    if (confiance?.score == null) {
      // Absence de score ≠ risque nul. Un vendeur sans historique est un
      // vendeur qu'on ne connaît pas, et le taire serait une omission.
      nonMesures.push('le niveau de confiance du vendeur, faute d’historique suffisant');
    } else if (confiance.score < 40) {
      signaux.push({ code: 'LOW_SELLER_TRUST', weight: POIDS_SIGNAUX.LOW_SELLER_TRUST.weight, evidence: `Confiance Touma : ${confiance.score}/100 (${confiance.level}).` });
    }

    // ── Montant inhabituel sur le corridor ─────────────────────────────────
    if (t.order.buyerCountry && t.order.sellerCountry) {
      const reference = await prisma.toumaOrder.aggregate({
        where: {
          crossBorder: true,
          buyerCountry: t.order.buyerCountry,
          sellerCountry: t.order.sellerCountry,
          currency: t.order.currency,
          id: { not: t.order.id },
        },
        _avg: { total: true },
        _count: { _all: true },
      });
      // Il faut un historique pour parler d'inhabituel. Sous le seuil, on ne
      // dit rien plutôt que de qualifier la première commande d'anormale.
      if (reference._count._all >= 5 && reference._avg.total) {
        const moyenne = new Prisma.Decimal(reference._avg.total);
        if (t.order.total.greaterThan(moyenne.mul(5))) {
          signaux.push({
            code: 'LARGE_TRANSACTION',
            weight: POIDS_SIGNAUX.LARGE_TRANSACTION.weight,
            evidence: `${t.order.total.toString()} ${t.order.currency}, soit plus de cinq fois la moyenne constatée (${moyenne.toFixed(0)}) sur ${reference._count._all} commandes de ce corridor.`,
          });
        }
      } else {
        nonMesures.push('le caractère inhabituel du montant, faute d’assez de commandes sur ce corridor');
      }
    }

    // ── Origine déclarée ───────────────────────────────────────────────────
    const sansOrigine = t.order.items.filter((i) => !i.product?.countryOfOrigin || i.product.originStatus === 'UNKNOWN').length;
    if (sansOrigine > 0) {
      signaux.push({ code: 'NO_ORIGIN_DECLARED', weight: POIDS_SIGNAUX.NO_ORIGIN_DECLARED.weight, evidence: `${sansOrigine} article(s) sans pays d’origine déclaré.` });
    }

    // ── Documents ──────────────────────────────────────────────────────────
    const rejetes = t.documents.filter((d) => d.status === 'REJECTED' || d.status === 'EXPIRED').length;
    if (rejetes > 0) {
      signaux.push({ code: 'DOCUMENT_INCONSISTENCY', weight: POIDS_SIGNAUX.DOCUMENT_INCONSISTENCY.weight, evidence: `${rejetes} document(s) rejeté(s) ou expiré(s).` });
    }

    // ── Paiement ───────────────────────────────────────────────────────────
    const echecs = t.order.payments.filter((p) => p.status === 'FAILED').length;
    if (echecs >= 2) {
      signaux.push({ code: 'PAYMENT_ANOMALY', weight: POIDS_SIGNAUX.PAYMENT_ANOMALY.weight, evidence: `${echecs} échecs de paiement sur cette commande.` });
    }

    // ── Acheminement ───────────────────────────────────────────────────────
    if (t.exceptions.length > 0) {
      signaux.push({ code: 'SHIPPING_ANOMALY', weight: POIDS_SIGNAUX.SHIPPING_ANOMALY.weight, evidence: `${t.exceptions.length} incident(s) d’acheminement non résolu(s).` });
    }

    const score = Math.min(100, signaux.reduce((a, s) => a + s.weight, 0));
    const action = actionPour(score);

    return {
      score,
      recommendedAction: action,
      signals: signaux,
      unmeasured: nonMesures,
      explanation:
        signaux.length === 0
          ? 'Aucun signal de risque relevé sur les critères mesurables.'
          : `${score}/100 : ${signaux.map((s) => `${POIDS_SIGNAUX[s.code]?.label ?? s.code} (+${s.weight})`).join(', ')}. Seuil « ${action} » : ${SEUILS.find((x) => x.action === action)!.min}.`,
      disclaimer:
        'Recommandation, pas décision. Suspendre une expédition ou exiger un document arrête le commerce de quelqu’un : cela se décide après lecture du dossier, jamais sur une addition de pondérations.',
    };
  },

  /** Les poids et les seuils, publiés. Un score opaque n'est pas contestable. */
  explainModel() {
    return {
      signals: Object.entries(POIDS_SIGNAUX).map(([code, v]) => ({ code, weight: v.weight, label: v.label })),
      thresholds: SEUILS,
      note: 'Ces poids sont des choix d’exploitation, pas des vérités. Ils se discutent et se modifient.',
    };
  },
};
