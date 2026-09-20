import type { ReviewRiskAction } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

/**
 * TOUMA TRUST — manipulation des avis.
 *
 * **Ce que le module fait.** Il compte des faits vérifiables et les pondère :
 * un avis déposé dans les minutes qui suivent la livraison, une rafale d'avis
 * du même compte, un acheteur et un vendeur qui partagent un numéro de
 * téléphone, un acheteur qui ne note qu'une seule boutique.
 *
 * **Ce qu'il ne fait pas.** Il ne masque rien. Il rend une recommandation —
 * `ALLOW`, `FLAG`, `HOLD`, `REVIEW` — et un humain tranche. Un avis sincère
 * effacé par une heuristique coûte plus cher à la confiance qu'un faux avis
 * laissé quelques jours de plus.
 *
 * **Ce qu'il ne regarde pas.** Ni adresse IP, ni empreinte d'appareil. TOUMA
 * ne les collecte pas, et l'énoncé le subordonnait au droit applicable : la
 * minimisation des données (§33) tranche dans l'autre sens tant que personne
 * n'a examiné la question au Tchad. Les signaux ci-dessous n'en ont pas besoin.
 */

/** Poids des signaux, en points de risque. Publiés, comme tout le reste. */
export const REVIEW_SIGNAL_WEIGHTS: Record<string, number> = {
  /** Avis déposé moins de 10 minutes après la livraison : personne n'a essayé le produit. */
  IMMEDIATE_AFTER_DELIVERY: 20,
  /** Plus de 5 avis du même compte en 24 h. */
  BURST_FROM_AUTHOR: 25,
  /** Le compte n'a jamais noté que cette boutique, sur au moins 4 avis. */
  SINGLE_STORE_AUTHOR: 20,
  /** Acheteur et vendeur partagent un numéro de téléphone. */
  LINKED_TO_SELLER: 40,
  /** Note extrême (1 ou 5) sans un mot d'explication. */
  EXTREME_WITHOUT_TEXT: 10,
  /** Le texte contient des coordonnées : c'est du démarchage, pas un avis. */
  CONTACT_DETAILS: 25,
};

const SEUILS: Array<{ action: ReviewRiskAction; min: number }> = [
  { action: 'HOLD', min: 60 },
  { action: 'REVIEW', min: 40 },
  { action: 'FLAG', min: 20 },
  { action: 'ALLOW', min: 0 },
];

function actionFor(score: number): ReviewRiskAction {
  return SEUILS.find((s) => score >= s.min)?.action ?? 'ALLOW';
}

/**
 * Coordonnées dans un texte d'avis.
 *
 * Volontairement conservateur : un numéro à huit chiffres ou plus, une adresse
 * électronique, un identifiant de messagerie. Un motif plus large attraperait
 * « j'ai commandé 3 fois » et ferait plus de mal que de bien.
 */
const COORDONNEES = [
  /\b\+?\d[\d\s.-]{7,}\d\b/,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b(whatsapp|telegram|wechat)\b/i,
];

export interface ReviewSignal {
  code: string;
  weight: number;
  detail: Record<string, unknown>;
}

/**
 * Évalue un avis. Lecture seule sur des faits déjà en base ; rien n'est
 * déduit d'une intention supposée.
 */
export async function assessReview(reviewId: string): Promise<{
  score: number;
  action: ReviewRiskAction;
  signals: ReviewSignal[];
}> {
  const review = await prisma.toumaReview.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      authorId: true,
      createdAt: true,
      rating: true,
      comment: true,
      product: { select: { storeId: true, store: { select: { ownerId: true } } } },
      order: { select: { deliveredAt: true } },
    },
  });
  if (!review) return { score: 0, action: 'ALLOW', signals: [] };

  const signals: ReviewSignal[] = [];
  const add = (code: string, detail: Record<string, unknown>) =>
    signals.push({ code, weight: REVIEW_SIGNAL_WEIGHTS[code] ?? 1, detail });

  // 1. Délai entre livraison et avis.
  if (review.order.deliveredAt) {
    const minutes = (review.createdAt.getTime() - review.order.deliveredAt.getTime()) / 60_000;
    if (minutes >= 0 && minutes < 10) add('IMMEDIATE_AFTER_DELIVERY', { minutesAfterDelivery: Math.round(minutes) });
  }

  // 2. Rafale d'avis du même compte.
  const depuis24h = new Date(Date.now() - 24 * 3600 * 1000);
  const recents = await prisma.toumaReview.count({
    where: { authorId: review.authorId, createdAt: { gte: depuis24h } },
  });
  if (recents > 5) add('BURST_FROM_AUTHOR', { reviewsLast24h: recents });

  // 3. Auteur qui ne note qu'une boutique.
  const tous = await prisma.toumaReview.findMany({
    where: { authorId: review.authorId },
    select: { product: { select: { storeId: true } } },
    take: 100,
  });
  const boutiques = new Set(tous.map((r) => r.product.storeId));
  if (tous.length >= 4 && boutiques.size === 1) {
    add('SINGLE_STORE_AUTHOR', { reviews: tous.length, distinctStores: boutiques.size });
  }

  // 4. Lien entre l'auteur et le vendeur.
  //
  // Le seul lien que TOUMA connaisse **de façon fiable** : le même compte, ou
  // un numéro de téléphone partagé (unique en base, donc un partage est déjà
  // une anomalie). Pas d'IP, pas d'empreinte d'appareil — voir l'en-tête.
  const ownerId = review.product.store?.ownerId;
  if (ownerId) {
    if (ownerId === review.authorId) {
      add('LINKED_TO_SELLER', { relation: 'SAME_ACCOUNT' });
    } else {
      const [auteur, vendeur] = await Promise.all([
        prisma.user.findUnique({ where: { id: review.authorId }, select: { phone: true } }),
        prisma.user.findUnique({ where: { id: ownerId }, select: { phone: true } }),
      ]);
      if (auteur?.phone && vendeur?.phone && auteur.phone === vendeur.phone) {
        add('LINKED_TO_SELLER', { relation: 'SHARED_PHONE' });
      }
    }
  }

  // 5. Note extrême sans un mot.
  const texte = (review.comment ?? '').trim();
  if ((review.rating === 1 || review.rating === 5) && texte.length === 0) {
    add('EXTREME_WITHOUT_TEXT', { rating: review.rating });
  }

  // 6. Coordonnées dans le texte.
  if (texte && COORDONNEES.some((r) => r.test(texte))) {
    add('CONTACT_DETAILS', { length: texte.length });
  }

  const score = Math.min(100, signals.reduce((acc, s) => acc + s.weight, 0));
  return { score, action: actionFor(score), signals };
}

/**
 * Évalue et consigne. L'action **n'est pas appliquée** ici : la consigner est
 * déjà utile — elle alimente la file de modération — et l'appliquer serait
 * masquer un avis sur un score probabiliste, ce que le §17 refuse.
 */
export async function scoreAndStore(reviewId: string) {
  const { score, action, signals } = await assessReview(reviewId);
  const payload = {
    score,
    action,
    signals: signals as unknown as Prisma.InputJsonValue,
    computedAt: new Date(),
  };
  await prisma.toumaReviewRiskScore.upsert({
    where: { reviewId },
    create: { reviewId, ...payload },
    update: payload,
  });

  // Un avis que le moteur recommande de retenir est **signalé**, pas masqué :
  // il reste visible jusqu'à ce qu'un humain décide, et il apparaît en tête de
  // la file de modération.
  if (action === 'HOLD' || action === 'REVIEW') {
    await prisma.toumaReview.updateMany({
      where: { id: reviewId, status: 'PUBLISHED' },
      data: { status: 'FLAGGED' },
    });
  }

  return { score, action, signals };
}
