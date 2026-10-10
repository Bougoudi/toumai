/**
 * TOUMA TRUST — pondérations, seuils et décroissance temporelle.
 *
 * **Tout est ici, et rien n'est caché ailleurs.** Un score de confiance qui
 * sortirait d'une formule invisible ne serait pas contestable ; un vendeur
 * sanctionné par un chiffre qu'il ne peut pas reconstituer n'a aucun recours
 * réel. Ce fichier est donc la référence unique, il est publié par l'API
 * (`GET /trust/weights`) et repris tel quel dans `docs/trust/scoring.md`.
 *
 * Les valeurs se règlent par variable d'environnement : une place de marché qui
 * démarre n'a pas les mêmes seuils qu'une place de marché installée, et il
 * faudra les ajuster avec des vendeurs réels plutôt que depuis ce fichier.
 */
import { env } from '../../config/env.js';

/** Sens d'une composante : elle ajoute ou elle retranche. */
export type Direction = 'POSITIVE' | 'NEGATIVE';

export interface TrustFactor {
  code: string;
  /** Poids maximal en points de score. Négatif pour une pénalité. */
  weight: number;
  direction: Direction;
}

/**
 * Composantes du score vendeur.
 *
 * Les quatre concepts de V21 y sont représentés sans être confondus :
 * VERIFICATION (pièces), PERFORMANCE (livraison, litiges, réactivité),
 * REPUTATION (avis) et RISK (signaux de fraude).
 *
 * Les positifs somment à 100. Les pénalités s'y retranchent, ce qui permet à un
 * vendeur par ailleurs irréprochable de perdre des points — sans quoi une
 * pénalité ne pénaliserait rien.
 */
export const SELLER_FACTORS: TrustFactor[] = [
  { code: 'VERIFICATION', weight: 20, direction: 'POSITIVE' },
  { code: 'DELIVERY', weight: 20, direction: 'POSITIVE' },
  { code: 'TRANSACTIONS', weight: 20, direction: 'POSITIVE' },
  { code: 'REVIEWS', weight: 15, direction: 'POSITIVE' },
  { code: 'CANCELLATION', weight: 15, direction: 'POSITIVE' },
  { code: 'RESPONSIVENESS', weight: 10, direction: 'POSITIVE' },
  { code: 'DISPUTES', weight: -15, direction: 'NEGATIVE' },
  { code: 'FRAUD_SIGNALS', weight: -30, direction: 'NEGATIVE' },
];

/**
 * Composantes du score acheteur.
 *
 * **Uniquement des comportements de place de marché.** Aucune variable de
 * nationalité, d'origine, de religion ou de genre n'entre ici, et le moteur
 * n'a pas accès à ces champs. La province n'y figure pas non plus : elle sert
 * à la logistique, pas à juger une personne.
 */
export const BUYER_FACTORS: TrustFactor[] = [
  { code: 'COMPLETED_ORDERS', weight: 35, direction: 'POSITIVE' },
  { code: 'PAYMENT_RELIABILITY', weight: 25, direction: 'POSITIVE' },
  { code: 'ACCOUNT_AGE', weight: 15, direction: 'POSITIVE' },
  { code: 'VERIFIED_CONTACT', weight: 10, direction: 'POSITIVE' },
  { code: 'NO_ABUSE', weight: 15, direction: 'POSITIVE' },
  { code: 'CANCELLATIONS', weight: -20, direction: 'NEGATIVE' },
  { code: 'FRAUD_SIGNALS', weight: -30, direction: 'NEGATIVE' },
];

/** Composantes du score produit. */
export const PRODUCT_FACTORS: TrustFactor[] = [
  { code: 'SELLER_TRUST', weight: 35, direction: 'POSITIVE' },
  { code: 'ORDER_VOLUME', weight: 25, direction: 'POSITIVE' },
  { code: 'REVIEWS', weight: 25, direction: 'POSITIVE' },
  { code: 'LOW_RETURNS', weight: 15, direction: 'POSITIVE' },
  { code: 'RETURNS', weight: -20, direction: 'NEGATIVE' },
];

/** Composantes du score fournisseur B2B. */
export const SUPPLIER_FACTORS: TrustFactor[] = [
  { code: 'VERIFICATION', weight: 25, direction: 'POSITIVE' },
  { code: 'QUOTE_RESPONSE', weight: 25, direction: 'POSITIVE' },
  { code: 'QUOTE_ACCEPTANCE', weight: 20, direction: 'POSITIVE' },
  { code: 'B2B_ORDERS', weight: 20, direction: 'POSITIVE' },
  { code: 'RESPONSE_SPEED', weight: 10, direction: 'POSITIVE' },
  { code: 'DISPUTES', weight: -20, direction: 'NEGATIVE' },
];

/**
 * Paliers. Ce sont des repères de lecture, pas des garanties : « EXCELLENT »
 * ne veut pas dire qu'une transaction ne peut pas mal se passer, et l'interface
 * ne doit jamais le laisser croire.
 */
export const LEVEL_THRESHOLDS = [
  { level: 'EXCELLENT' as const, min: 85 },
  { level: 'GOOD' as const, min: 70 },
  { level: 'MODERATE' as const, min: 50 },
  { level: 'LOW' as const, min: 0 },
];

/**
 * Décroissance temporelle.
 *
 * Un litige d'il y a deux ans ne dit pas grand-chose d'un vendeur
 * d'aujourd'hui, et le faire peser autant qu'un litige de la semaine dernière
 * condamnerait quiconque s'est corrigé. Le poids d'un événement est multiplié
 * par `0.5 ^ (âge / demi-vie)` : à la demi-vie il compte pour moitié, au double
 * pour un quart.
 *
 * **L'historique n'est jamais supprimé** : c'est le poids qui décroît, pas la
 * trace. Une décision prise il y a trois ans doit rester relisible.
 */
export const DECAY = {
  /** Demi-vie d'un événement négatif, en jours. */
  halfLifeDays: env.touma.trust.decayHalfLifeDays,
  /** Au-delà, le poids est considéré comme nul (évite une traîne infinie). */
  horizonDays: env.touma.trust.decayHorizonDays,
};

/**
 * Facteur de décroissance d'un événement, entre 0 et 1.
 *
 * **Un fait du jour pèse exactement 1.** La formule continue rendait
 * 0,999999996 pour un fait vieux d'une milliseconde : mathématiquement exact,
 * et faux en pratique — un litige ouvert il y a une seconde n'est pas
 * « légèrement moins récent » qu'un litige ouvert à l'instant. La journée est
 * l'unité de la décroissance, elle doit l'être aussi de son plancher.
 *
 * Sans ce palier, le même calcul rendait deux résultats selon la
 * milliseconde d'exécution.
 */
export function decayFactor(occurredAt: Date, now: Date = new Date()): number {
  const ageDays = (now.getTime() - occurredAt.getTime()) / 86_400_000;
  if (ageDays < 1) return 1;
  if (ageDays >= DECAY.horizonDays) return 0;
  return 0.5 ** (ageDays / DECAY.halfLifeDays);
}

/**
 * Volume minimal avant de publier un score.
 *
 * En dessous, le score vaut `null` et l'interface dit « pas encore assez de
 * données ». Un « 100/100 » sur deux ventes tromperait plus sûrement qu'une
 * absence de score — c'est la règle que `reputation.service.ts` applique déjà
 * aux taux, reprise ici pour le score global.
 */
export const MIN_SAMPLE = {
  seller: env.touma.trust.minSellerOrders,
  buyer: env.touma.trust.minBuyerOrders,
  product: env.touma.trust.minProductOrders,
  supplier: env.touma.trust.minSupplierQuotes,
};


/**
 * Seuils de normalisation.
 *
 * Une mesure brute (« 3 litiges ») ne se met pas telle quelle dans un score :
 * il faut dire à partir de quand elle est mauvaise. Ces bornes le disent, et
 * elles sont ici plutôt que dispersées dans les calculs pour qu'on puisse les
 * discuter en un seul endroit.
 */
export const THRESHOLDS = {
  /** Volume de commandes livrées au-delà duquel l'antériorité est « pleine ». */
  sellerTrackRecord: Number(process.env.TOUMA_TRUST_TRACK_RECORD ?? 50),
  /** Commandes terminées au-delà desquelles un acheteur est « installé ». */
  buyerTrackRecord: Number(process.env.TOUMA_TRUST_BUYER_TRACK_RECORD ?? 20),
  /** Commandes d'un produit au-delà desquelles son volume est « plein ». */
  productTrackRecord: Number(process.env.TOUMA_TRUST_PRODUCT_TRACK_RECORD ?? 30),
  /** Ancienneté de compte, en jours, au-delà de laquelle la composante est pleine. */
  accountAgeDays: Number(process.env.TOUMA_TRUST_ACCOUNT_AGE_DAYS ?? 365),
  /** Taux de litige à partir duquel la pénalité est entière. */
  disputeRateFull: Number(process.env.TOUMA_TRUST_DISPUTE_RATE_FULL ?? 0.1),
  /** Taux de retour à partir duquel la pénalité est entière. */
  returnRateFull: Number(process.env.TOUMA_TRUST_RETURN_RATE_FULL ?? 0.25),
  /** Taux d'annulation acheteur à partir duquel la pénalité est entière. */
  cancelRateFull: Number(process.env.TOUMA_TRUST_CANCEL_RATE_FULL ?? 0.3),
  /** Délai de réponse à un appel d'offres, en heures, au-delà duquel c'est lent. */
  quoteResponseHours: Number(process.env.TOUMA_TRUST_QUOTE_RESPONSE_HOURS ?? 48),
};

/**
 * Part de score accordée par niveau de vérification.
 *
 * `NONE` vaut zéro et non `null` : l'absence de vérification est un fait
 * mesurable, pas une mesure manquante. Ne pas être vérifié n'est pas une
 * faute, mais ce n'est pas non plus une garantie, et le score le dit.
 */
export const VERIFICATION_VALUE: Record<string, number> = {
  NONE: 0,
  BASIC: 0.5,
  BUSINESS: 0.75,
  PRO: 0.9,
  ENTERPRISE: 1,
};
