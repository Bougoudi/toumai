import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { RecommendationItem } from './ai.types.recommend.js';

/**
 * Recommandations produits, calculées sur le catalogue réel.
 *
 * Aucune intelligence artificielle n'intervient ici, et c'est volontaire : une
 * recommandation est un **fait** tiré de la base — même catégorie, même pays,
 * prix voisin, ventes constatées. Un modèle de langage saurait la formuler ; il
 * ne saurait pas la fonder, et une recommandation inventée mène l'acheteur vers
 * un produit qui n'existe pas (§71).
 *
 * Deux corrections par rapport à l'implémentation d'origine :
 *
 * - les recommandations sont **rattachées** à l'appel qui les a produites
 *   (`requestId`), ce qui n'était pas fait : toutes les lignes écrites
 *   jusqu'ici étaient orphelines et donc inauditables ;
 * - l'écriture n'a plus lieu pour un visiteur anonyme. Une lecture n'a pas à
 *   remplir la base, et le point d'entrée était ouvert sans authentification.
 */

export interface RecommendInput {
  useCase: 'similar_products' | 'supplier_match' | 'opportunity';
  userId?: string | null;
  seedProductId?: string | null;
  query?: string;
  limit?: number;
}

const selection = {
  id: true,
  title: true,
  slug: true,
  price: true,
  currency: true,
  categoryId: true,
  countryCode: true,
  images: { select: { url: true }, take: 1 },
  store: { select: { id: true, name: true, slug: true, verificationStatus: true } },
  inventory: { select: { quantity: true } },
} satisfies Prisma.ToumaProductSelect;

type Ligne = Prisma.ToumaProductGetPayload<{ select: typeof selection }>;

function carte(p: Ligne, score: number, reason: string): RecommendationItem {
  const stock = p.inventory.reduce((a, i) => a + i.quantity, 0);
  return {
    targetType: 'PRODUCT',
    targetId: p.id,
    score,
    reason,
    payload: {
      title: p.title,
      slug: p.slug,
      price: p.price.toString(),
      currency: p.currency,
      image: p.images[0]?.url ?? null,
      store: p.store,
      inStock: stock > 0,
    },
  };
}

export const recommendationService = {
  /**
   * Produits voisins d'un produit donné.
   *
   * L'ordre des critères porte le sens : la catégorie d'abord, le prix voisin
   * ensuite, le pays d'expédition en dernier. Un acheteur qui regarde un
   * téléphone à 80 000 XAF veut un autre téléphone, pas un autre article
   * expédié du même pays.
   */
  async similar(seedProductId: string, limit: number): Promise<RecommendationItem[]> {
    const seed = await prisma.toumaProduct.findFirst({
      where: { id: seedProductId, status: 'ACTIVE', store: { status: 'ACTIVE' } },
      select: { id: true, categoryId: true, countryCode: true, price: true, currency: true },
    });
    if (!seed) return [];

    const base: Prisma.ToumaProductWhereInput = { id: { not: seed.id }, status: 'ACTIVE', store: { status: 'ACTIVE' } };
    // Fourchette de ±40 % : assez large pour proposer, assez étroite pour ne
    // pas mettre un article à 500 000 XAF en face d'un à 20 000.
    const bas = seed.price.mul(new Prisma.Decimal('0.6'));
    const haut = seed.price.mul(new Prisma.Decimal('1.4'));

    const memeCategorie = seed.categoryId
      ? await prisma.toumaProduct.findMany({
          where: { ...base, categoryId: seed.categoryId, currency: seed.currency, price: { gte: bas, lte: haut } },
          select: selection,
          take: limit,
          orderBy: { orderItems: { _count: 'desc' } },
        })
      : [];

    const items = memeCategorie.map((p) => carte(p, 0.9, 'Même catégorie, prix comparable'));
    if (items.length >= limit) return items;

    const dejaVus = new Set([seed.id, ...items.map((i) => i.targetId)]);
    const complement = await prisma.toumaProduct.findMany({
      where: {
        ...base,
        id: { notIn: [...dejaVus].filter((v): v is string => v !== null) },
        ...(seed.categoryId ? { categoryId: seed.categoryId } : { countryCode: seed.countryCode }),
      },
      select: selection,
      take: limit - items.length,
      orderBy: { createdAt: 'desc' },
    });
    return [...items, ...complement.map((p) => carte(p, seed.categoryId ? 0.7 : 0.5, seed.categoryId ? 'Même catégorie' : 'Même pays d’expédition'))];
  },

  /** Produits les plus commandés, éventuellement filtrés par une recherche. */
  async popular(query: string | undefined, limit: number): Promise<RecommendationItem[]> {
    const rows = await prisma.toumaProduct.findMany({
      where: {
        status: 'ACTIVE',
        store: { status: 'ACTIVE' },
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: 'insensitive' as const } },
                { keywords: { contains: query, mode: 'insensitive' as const } },
                { brand: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: selection,
      take: limit,
      orderBy: { orderItems: { _count: 'desc' } },
    });
    return rows.map((p) => carte(p, 0.6, query ? `Correspond à « ${query} »` : 'Parmi les produits les plus commandés'));
  },

  /**
   * Persiste les recommandations d'un appel identifié.
   *
   * Rattachées à leur requête, donc auditables : on peut dire quelle demande a
   * produit quelle proposition. Et réservées aux utilisateurs connus : une
   * lecture anonyme ne doit pas écrire.
   */
  async persist(requestId: string | null, items: RecommendationItem[]): Promise<void> {
    if (!requestId || items.length === 0) return;
    await prisma.toumaAiRecommendation
      .createMany({
        data: items.map((i) => ({
          requestId,
          targetType: i.targetType,
          targetId: i.targetId,
          score: i.score.toFixed(4),
          reason: i.reason,
          payload: (i.payload ?? {}) as object,
        })),
      })
      .catch(() => undefined);
  },
};
