import type { Offer, Supplier } from '@prisma/client';

/** Critères de recherche normalisés utilisés par le moteur de matching. */
export interface SearchCriteria {
  query: string;
  category?: string | null;
  keywords: string[];
  targetUnitPrice?: number | null;
  targetQuantity?: number | null;
  region?: string | null;
  requiredCertifications: string[];
}

/** Détail transparent du calcul de score (pour audit / affichage UI). */
export interface ScoreBreakdown {
  relevance: number; // pertinence texte / catégorie
  price: number; // adéquation prix
  moq: number; // adéquation quantité minimale
  leadTime: number; // délai de livraison
  region: number; // proximité géographique
  reputation: number; // note + vérification
  certifications: number; // couverture des certifications requises
  total: number; // score global 0..100
}

/** Pondération de chaque critère (la somme vaut 1). */
const WEIGHTS = {
  relevance: 0.3,
  price: 0.2,
  moq: 0.1,
  leadTime: 0.1,
  region: 0.1,
  reputation: 0.1,
  certifications: 0.1,
} as const;

export function parseList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Pertinence textuelle : recouvrement des mots-clés + correspondance de catégorie. */
function relevanceScore(criteria: SearchCriteria, supplier: Supplier, offer?: Offer | null): number {
  const haystack = [
    supplier.name,
    supplier.certifications,
    offer?.title ?? '',
    offer?.keywords ?? '',
    offer?.category ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const terms = new Set<string>([...criteria.keywords, ...parseList(criteria.query)]);

  let categoryHit = 0;
  if (criteria.category && offer?.category) {
    categoryHit = offer.category.toLowerCase() === criteria.category.toLowerCase() ? 1 : 0;
  }

  if (terms.size === 0) return categoryHit ? 1 : 0.5;

  let hits = 0;
  for (const term of terms) {
    if (term && haystack.includes(term)) hits += 1;
  }
  const keywordScore = hits / terms.size;

  // 70 % mots-clés, 30 % catégorie.
  return clamp01(keywordScore * 0.7 + categoryHit * 0.3);
}

/** Adéquation prix : plus le prix de l'offre est proche/inférieur à la cible, meilleur est le score. */
function priceScore(criteria: SearchCriteria, offer?: Offer | null): number {
  if (criteria.targetUnitPrice == null || offer?.unitPrice == null) return 0.5; // inconnu → neutre
  const target = criteria.targetUnitPrice;
  const price = offer.unitPrice;
  if (price <= target) return 1; // au niveau ou en dessous de la cible
  const overshoot = (price - target) / target; // dépassement relatif
  return clamp01(1 - overshoot); // 100 % de dépassement → score 0
}

/** Adéquation MOQ : la quantité minimale du fournisseur doit être <= à la quantité voulue. */
function moqScore(criteria: SearchCriteria, offer?: Offer | null): number {
  if (criteria.targetQuantity == null || offer?.moq == null) return 0.5;
  if (offer.moq <= criteria.targetQuantity) return 1;
  const ratio = criteria.targetQuantity / offer.moq;
  return clamp01(ratio);
}

/** Délai de livraison : décroît linéairement jusqu'à 60 jours. */
function leadTimeScore(supplier: Supplier, offer?: Offer | null): number {
  const days = offer?.leadTimeDays ?? supplier.leadTimeDays;
  if (days == null) return 0.5;
  return clamp01(1 - days / 60);
}

/** Proximité géographique : correspondance exacte de région privilégiée. */
function regionScore(criteria: SearchCriteria, supplier: Supplier): number {
  if (!criteria.region) return 0.5;
  const wanted = criteria.region.toLowerCase();
  const supplierRegion = (supplier.region ?? supplier.country ?? '').toLowerCase();
  if (!supplierRegion) return 0.3;
  return supplierRegion.includes(wanted) || wanted.includes(supplierRegion) ? 1 : 0.2;
}

/** Réputation : note /5 (80 %) + bonus vérification (20 %). */
function reputationScore(supplier: Supplier): number {
  const rating = clamp01((supplier.rating ?? 0) / 5);
  const verified = supplier.verified ? 1 : 0;
  return clamp01(rating * 0.8 + verified * 0.2);
}

/** Couverture des certifications requises. */
function certificationsScore(criteria: SearchCriteria, supplier: Supplier): number {
  if (criteria.requiredCertifications.length === 0) return 1; // aucune exigence
  const owned = new Set(parseList(supplier.certifications));
  const covered = criteria.requiredCertifications.filter((c) => owned.has(c)).length;
  return clamp01(covered / criteria.requiredCertifications.length);
}

/**
 * Calcule le score global (0..100) d'un fournisseur pour une recherche,
 * en tenant compte de sa meilleure offre s'il y en a une.
 */
export function scoreSupplier(
  criteria: SearchCriteria,
  supplier: Supplier,
  offer?: Offer | null,
): ScoreBreakdown {
  const parts = {
    relevance: relevanceScore(criteria, supplier, offer),
    price: priceScore(criteria, offer),
    moq: moqScore(criteria, offer),
    leadTime: leadTimeScore(supplier, offer),
    region: regionScore(criteria, supplier),
    reputation: reputationScore(supplier),
    certifications: certificationsScore(criteria, supplier),
  };

  const weighted =
    parts.relevance * WEIGHTS.relevance +
    parts.price * WEIGHTS.price +
    parts.moq * WEIGHTS.moq +
    parts.leadTime * WEIGHTS.leadTime +
    parts.region * WEIGHTS.region +
    parts.reputation * WEIGHTS.reputation +
    parts.certifications * WEIGHTS.certifications;

  const round = (n: number) => Math.round(n * 100);

  return {
    relevance: round(parts.relevance),
    price: round(parts.price),
    moq: round(parts.moq),
    leadTime: round(parts.leadTime),
    region: round(parts.region),
    reputation: round(parts.reputation),
    certifications: round(parts.certifications),
    total: round(weighted),
  };
}
