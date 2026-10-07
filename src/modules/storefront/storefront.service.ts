import type { Product } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';

/** Produit vendable sur la boutique : actif et avec un prix. */
const SELLABLE = { status: 'ACTIVE', salePrice: { gt: 0 } } as const;

/** « Écouteurs Sans Fil Pro » → « ecouteurs-sans-fil-pro » (URL lisible, bonne pour le SEO). */
export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'produit'
  );
}

/** URL canonique d'un produit : /boutique/produit/<slug>-<id>. */
export function productPath(p: Pick<Product, 'id' | 'name'>): string {
  return `/boutique/produit/${slugify(p.name)}-${p.id}`;
}

export function categoryPath(category: string): string {
  return `/boutique/categorie/${slugify(category)}`;
}

export function productImages(p: Pick<Product, 'images'>): string[] {
  return p.images
    .split(',')
    .map((s) => s.trim())
    .filter((u) => /^https:\/\//.test(u));
}

/** Remise par lot (en %) selon la quantité commandée : 2 → bundleTwoPct, 3+ → bundleThreePct. */
export function bundlePct(shop: { bundleTwoPct: number; bundleThreePct: number }, qty: number): number {
  if (qty >= 3) return Math.max(0, shop.bundleThreePct || 0);
  if (qty === 2) return Math.max(0, shop.bundleTwoPct || 0);
  return 0;
}

/** Prix unitaire après remise par lot, arrondi au centime. */
export function bundleUnitPrice(shop: { bundleTwoPct: number; bundleThreePct: number }, qty: number, unit: number): number {
  return Math.round(unit * (1 - bundlePct(shop, qty) / 100) * 100) / 100;
}

/** Points forts : une ligne « Titre | texte » (ou juste « Titre ») par point. */
export function productHighlights(p: Pick<Product, 'highlights'>): { title: string; text: string }[] {
  return p.highlights
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => {
      const i = l.indexOf('|');
      return i < 0 ? { title: l, text: '' } : { title: l.slice(0, i).trim(), text: l.slice(i + 1).trim() };
    });
}

export function productSteps(p: Pick<Product, 'steps'>): string[] {
  return p.steps
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export const storefrontService = {
  async listProducts(params: { take?: number; category?: string } = {}) {
    return prisma.product.findMany({
      where: { ...SELLABLE, ...(params.category ? { category: params.category } : {}) },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 60,
    });
  },

  /** Catégories ayant au moins un produit en vente (pour le menu et les pages catégorie). */
  async listCategories(): Promise<{ name: string; slug: string; count: number }[]> {
    const rows = await prisma.product.groupBy({ by: ['category'], where: SELLABLE, _count: { _all: true } });
    return rows
      .map((r) => ({ name: r.category, slug: slugify(r.category), count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  },

  async findCategory(slug: string) {
    const cats = await this.listCategories();
    return cats.find((c) => c.slug === slug) ?? null;
  },

  /** Le slug est décoratif : l'identifiant (après le dernier tiret) fait foi. */
  async getProductBySlug(slugWithId: string) {
    const id = slugWithId.slice(slugWithId.lastIndexOf('-') + 1);
    const product = id ? await prisma.product.findFirst({ where: { id, ...SELLABLE } }) : null;
    if (!product) throw new HttpError(404, 'Produit introuvable');
    return product;
  },

  async related(product: Product, take = 4) {
    return prisma.product.findMany({
      where: { ...SELLABLE, category: product.category, id: { not: product.id } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  /** Produit mis en avant (page de vente de l'accueil), s'il est en vente. */
  async featured(id: string) {
    if (!id) return null;
    return prisma.product.findFirst({ where: { id, ...SELLABLE } });
  },

  async sitemapEntries() {
    return prisma.product.findMany({
      where: SELLABLE,
      select: { id: true, name: true, updatedAt: true, images: true },
      orderBy: { updatedAt: 'desc' },
      take: 45_000,
    });
  },
};
