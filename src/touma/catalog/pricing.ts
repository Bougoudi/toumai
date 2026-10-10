import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest } from '../lib/errors.js';
import { assertSameCurrency } from '../lib/money.js';

/**
 * Paliers de prix B2B.
 *
 * Le commerce de gros ne se fait pas à prix fixe : à partir d'une certaine
 * quantité, le prix unitaire baisse. TOUMA ne savait pas l'exprimer — un
 * produit avait un prix, qu'on en achète dix ou dix mille.
 *
 * Deux règles, et la seconde est celle qui compte :
 *
 * **Le palier est choisi par le serveur, jamais demandé par le client.** Un
 * client qui enverrait « je veux le palier à 500 » est ignoré : seule la
 * quantité réellement commandée détermine le prix. C'est la même règle que pour
 * les totaux, appliquée un cran plus tôt.
 *
 * **Un palier ne peut pas augmenter le prix.** Un palier au-dessus du prix
 * catalogue serait soit une erreur de saisie, soit un piège ; dans les deux cas
 * l'acheteur paie le prix affiché. Le serveur retient donc le plus petit des
 * deux.
 */

export interface PriceTierInput {
  minQuantity: number;
  unitPrice: string;
}

export interface TierLike {
  minQuantity: number;
  unitPrice: Prisma.Decimal;
  currency: string;
}

export interface ResolvedPrice {
  /** Prix unitaire à appliquer. */
  unitPrice: Prisma.Decimal;
  /** Palier retenu, ou `null` si c'est le prix catalogue qui s'applique. */
  appliedTier: { minQuantity: number; unitPrice: string } | null;
  /** Prix catalogue, conservé pour la trace. */
  listPrice: Prisma.Decimal;
}

/**
 * Choisit le prix unitaire pour une quantité donnée. Fonction pure — les
 * paliers sont fournis, pas lus en base — pour que l'aperçu du panier et
 * l'écriture de la commande passent exactement par le même calcul.
 */
export function resolveUnitPrice(listPrice: Prisma.Decimal, currency: string, quantity: number, tiers: TierLike[]): ResolvedPrice {
  const applicables = tiers
    .filter((t) => t.minQuantity <= quantity)
    .sort((a, b) => b.minQuantity - a.minQuantity);

  const meilleur = applicables[0];
  if (!meilleur) return { unitPrice: listPrice, appliedTier: null, listPrice };

  assertSameCurrency(meilleur.currency, currency);

  // Un palier plus cher que le prix affiché ne s'applique pas.
  if (meilleur.unitPrice.greaterThanOrEqualTo(listPrice)) {
    return { unitPrice: listPrice, appliedTier: null, listPrice };
  }

  return {
    unitPrice: meilleur.unitPrice,
    appliedTier: { minQuantity: meilleur.minQuantity, unitPrice: meilleur.unitPrice.toString() },
    listPrice,
  };
}

/**
 * Charge les paliers d'un lot de produits en une seule requête — un panier de
 * vingt lignes ne doit pas produire vingt allers-retours.
 *
 * La clé de la table renvoyée est `productId` ; les paliers propres à une
 * variante sont filtrés au moment de résoudre le prix.
 */
export async function loadTiers(productIds: string[]): Promise<Map<string, (TierLike & { variantId: string | null })[]>> {
  const table = new Map<string, (TierLike & { variantId: string | null })[]>();
  if (productIds.length === 0) return table;

  const rows = await prisma.toumaPriceTier.findMany({
    where: { productId: { in: [...new Set(productIds)] } },
    select: { productId: true, variantId: true, minQuantity: true, unitPrice: true, currency: true },
    orderBy: { minQuantity: 'asc' },
  });

  for (const row of rows) {
    const list = table.get(row.productId) ?? [];
    list.push(row);
    table.set(row.productId, list);
  }
  return table;
}

/**
 * Paliers applicables à une ligne : ceux de la variante commandée, et ceux qui
 * valent pour tout le produit.
 */
export function tiersFor(all: (TierLike & { variantId: string | null })[] | undefined, variantId: string | null): TierLike[] {
  if (!all) return [];
  return all.filter((t) => t.variantId === null || t.variantId === variantId);
}

// ── Administration des paliers (côté vendeur) ────────────────────────────────

/**
 * Remplace les paliers d'un produit. Le vendeur envoie la grille complète : la
 * modification partielle d'une grille tarifaire est une source d'erreurs, et
 * une grille se relit d'un coup d'œil.
 */
export async function replaceTiers(productId: string, currency: string, tiers: PriceTierInput[], variantId: string | null = null) {
  const vus = new Set<number>();
  const data = tiers.map((t) => {
    if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2) {
      throw badRequest('Un palier commence à une quantité entière d’au moins 2.');
    }
    if (vus.has(t.minQuantity)) throw badRequest(`Deux paliers déclarés pour la quantité ${t.minQuantity}.`);
    vus.add(t.minQuantity);

    const unitPrice = new Prisma.Decimal(t.unitPrice);
    if (unitPrice.lessThanOrEqualTo(0)) throw badRequest('Le prix d’un palier doit être strictement positif.');
    return { productId, variantId, minQuantity: t.minQuantity, unitPrice, currency };
  });

  return prisma.$transaction(async (tx) => {
    await tx.toumaPriceTier.deleteMany({ where: { productId, variantId } });
    if (data.length > 0) await tx.toumaPriceTier.createMany({ data });
    return tx.toumaPriceTier.findMany({ where: { productId }, orderBy: { minQuantity: 'asc' } });
  });
}
