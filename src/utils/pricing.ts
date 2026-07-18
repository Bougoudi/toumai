import { env } from '../config/env.js';

/** Arrondi « psychologique » à .99 (ex: 24.99). */
export function toCharmPrice(value: number): number {
  const rounded = Math.max(0, Math.round(value) - 0.01);
  return Number(rounded.toFixed(2));
}

/** Calcule le prix de vente à partir du prix d'achat et d'un markup. */
export function computeSalePrice(costPrice: number, markup = env.pricing.defaultMarkup): number {
  return toCharmPrice(costPrice * markup);
}

/** Marge absolue. */
export function computeMargin(salePrice: number, costPrice: number): number {
  return Number((salePrice - costPrice).toFixed(2));
}

/** Marge en pourcentage du prix de vente. */
export function marginPercent(salePrice: number, costPrice: number): number {
  if (salePrice <= 0) return 0;
  return Number((((salePrice - costPrice) / salePrice) * 100).toFixed(1));
}
