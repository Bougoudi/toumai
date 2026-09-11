import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { uniqueSlug } from '../lib/slug.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './product.schema.js';

/** Projection publique d'un produit (liste). */
const listSelect = {
  id: true,
  title: true,
  slug: true,
  price: true,
  compareAtPrice: true,
  currency: true,
  minOrderQty: true,
  countryCode: true,
  status: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
  store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true, ratingAverage: true } },
  category: { select: { id: true, name: true, slug: true } },
  images: { select: { url: true, alt: true }, orderBy: { position: 'asc' as const }, take: 1 },
  inventory: { select: { quantity: true, variantId: true } },
} satisfies Prisma.ToumaProductSelect;

/** Stock total disponible d'un produit (toutes variantes confondues). */
function totalStock(inventory: Array<{ quantity: number }>): number {
  return inventory.reduce((acc, i) => acc + i.quantity, 0);
}

function serializeList(p: Prisma.ToumaProductGetPayload<{ select: typeof listSelect }>) {
  const stock = totalStock(p.inventory);
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    price: p.price.toString(),
    compareAtPrice: p.compareAtPrice?.toString() ?? null,
    currency: p.currency,
    minOrderQty: p.minOrderQty,
    countryCode: p.countryCode,
    status: p.status,
    rating: Number(p.ratingAverage),
    ratingCount: p.ratingCount,
    image: p.images[0]?.url ?? null,
    store: p.store,
    category: p.category,
    stock,
    inStock: stock > 0,
    createdAt: p.createdAt,
  };
}

/** Dimensions filtrables, pour pouvoir en exclure une au calcul des facettes. */
export type FilterDimension = 'category' | 'country' | 'store' | 'price' | 'availability' | 'verified';

/**
 * Construit les filtres d'une recherche produit.
 *
 * `exclude` sert au calcul des facettes : le compteur d'une dimension doit être
 * calculé **sans** le filtre de cette dimension, sinon choisir « Cameroun »
 * ferait tomber à zéro le compteur de tous les autres pays et l'acheteur ne
 * pourrait plus changer d'avis sans tout réinitialiser.
 */
export function buildProductFilters(
  query: ListProductsQuery,
  options: { exclude?: FilterDimension } = {},
): Prisma.ToumaProductWhereInput[] {
  const and: Prisma.ToumaProductWhereInput[] = [{ status: 'ACTIVE' }, { store: { status: 'ACTIVE' } }];

  if (query.q) {
    const q = query.q;
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { keywords: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
        { store: { name: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  if (query.category && options.exclude !== 'category') {
    and.push({ category: { OR: [{ id: query.category }, { slug: query.category }] } });
  }
  if (query.country && options.exclude !== 'country') and.push({ countryCode: query.country });
  if (query.store && options.exclude !== 'store') and.push({ store: { OR: [{ id: query.store }, { slug: query.store }] } });
  if (options.exclude !== 'price') {
    if (query.minPrice) and.push({ price: { gte: new Prisma.Decimal(query.minPrice) } });
    if (query.maxPrice) and.push({ price: { lte: new Prisma.Decimal(query.maxPrice) } });
  }
  if (query.verifiedOnly === 'true' && options.exclude !== 'verified') {
    and.push({ store: { verificationStatus: 'APPROVED' } });
  }
  if (options.exclude !== 'availability') {
    if (query.availability === 'in_stock') and.push({ inventory: { some: { quantity: { gt: 0 } } } });
    if (query.availability === 'out_of_stock') and.push({ inventory: { every: { quantity: { lte: 0 } } } });
  }
  return and;
}

export const productService = {
  /** Recherche/filtrage du catalogue public (pagination côté serveur). */
  async list(query: ListProductsQuery) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where: Prisma.ToumaProductWhereInput = { AND: buildProductFilters(query) };
    const orderBy: Prisma.ToumaProductOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { price: 'asc' }
        : query.sort === 'price_desc'
          ? { price: 'desc' }
          : query.sort === 'popular'
            ? { orderItems: { _count: 'desc' } }
            : { createdAt: 'desc' };

    const [rows, total] = await Promise.all([
      prisma.toumaProduct.findMany({ where, select: listSelect, orderBy, skip: page.skip, take: page.limit }),
      prisma.toumaProduct.count({ where }),
    ]);
    return paginated(rows.map(serializeList), total, page);
  },

  /** Fiche produit publique (id ou slug). Les brouillons restent privés. */
  async get(idOrSlug: string, viewer?: ToumaRequestUser) {
    const product = await prisma.toumaProduct.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        store: { select: { id: true, name: true, slug: true, ownerId: true, countryCode: true, city: true, status: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
        category: { select: { id: true, name: true, slug: true } },
        images: { orderBy: { position: 'asc' } },
        variants: { where: { active: true }, orderBy: { position: 'asc' }, include: { inventory: true } },
        inventory: true,
        reviews: {
          where: { status: 'PUBLISHED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, rating: true, comment: true, createdAt: true, author: { select: { name: true } } },
        },
      },
    });
    if (!product) throw notFound('Produit introuvable.');

    const isOwner = viewer && (viewer.id === product.store.ownerId || viewer.role === 'ADMIN');
    if (product.status !== 'ACTIVE' && !isOwner) throw notFound('Produit introuvable.');

    const stock = totalStock(product.inventory);
    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      sku: product.sku,
      price: product.price.toString(),
      compareAtPrice: product.compareAtPrice?.toString() ?? null,
      currency: product.currency,
      minOrderQty: product.minOrderQty,
      weightGrams: product.weightGrams,
      countryCode: product.countryCode,
      status: product.status,
      rating: Number(product.ratingAverage),
      ratingCount: product.ratingCount,
      store: { ...product.store, ownerId: undefined },
      category: product.category,
      images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, position: i.position })),
      variants: product.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        priceDelta: v.priceDelta.toString(),
        price: product.price.plus(v.priceDelta).toString(),
        stock: v.inventory?.quantity ?? 0,
      })),
      stock,
      inStock: stock > 0,
      reviews: product.reviews,
      createdAt: product.createdAt,
      publishedAt: product.publishedAt,
    };
  },

  /** Produits d'une boutique du vendeur (vue privée : tous statuts). */
  async listForSeller(user: ToumaRequestUser, query: { storeId?: string; status?: string; page: number; limit: number }) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where: Prisma.ToumaProductWhereInput = {
      store: user.role === 'ADMIN' && query.storeId ? { id: query.storeId } : { ownerId: user.id, ...(query.storeId ? { id: query.storeId } : {}) },
      ...(query.status ? { status: query.status as Prisma.EnumProductStatusFilter['equals'] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.toumaProduct.findMany({ where, select: listSelect, orderBy: { updatedAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaProduct.count({ where }),
    ]);
    return paginated(rows.map(serializeList), total, page);
  },

  /** Vérifie que le produit appartient bien au vendeur (anti-IDOR). */
  async requireOwned(productId: string, user: ToumaRequestUser) {
    const product = await prisma.toumaProduct.findUnique({ where: { id: productId }, include: { store: true } });
    if (!product) throw notFound('Produit introuvable.');
    if (product.store.ownerId !== user.id && user.role !== 'ADMIN') {
      throw forbidden('Vous ne pouvez modifier que les produits de votre boutique.');
    }
    return product;
  },

  async create(user: ToumaRequestUser, input: CreateProductInput) {
    const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId }, include: { country: true } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') {
      throw forbidden('Vous ne pouvez publier que dans votre propre boutique.');
    }
    if (input.categoryId) {
      const category = await prisma.toumaCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw badRequest('Catégorie inconnue.');
    }
    const countryCode = input.countryCode ?? store.countryCode;
    const country = await prisma.country.findUnique({ where: { code: countryCode } });
    if (!country || !country.active) throw badRequest(`Pays « ${countryCode} » non desservi.`);
    const currency = input.currency ?? country.currency ?? env.touma.defaultCurrency;

    const slug = await uniqueSlug(input.title, async (s) => (await prisma.toumaProduct.count({ where: { slug: s } })) > 0);

    return prisma.$transaction(async (tx) => {
      const product = await tx.toumaProduct.create({
        data: {
          storeId: store.id,
          categoryId: input.categoryId ?? null,
          title: input.title,
          slug,
          description: input.description,
          brand: input.brand ?? null,
          sku: input.sku ?? null,
          price: new Prisma.Decimal(input.price),
          compareAtPrice: input.compareAtPrice ? new Prisma.Decimal(input.compareAtPrice) : null,
          currency,
          countryCode,
          minOrderQty: input.minOrderQty,
          weightGrams: input.weightGrams,
          keywords: input.keywords,
          status: input.status,
          publishedAt: input.status === 'ACTIVE' ? new Date() : null,
          images: { create: input.images.map((img, i) => ({ url: img.url, alt: img.alt ?? null, position: img.position || i })) },
        },
      });

      // Stock : une ligne par variante, sinon une ligne « produit simple ».
      if (input.variants.length > 0) {
        for (const [i, v] of input.variants.entries()) {
          const variant = await tx.toumaProductVariant.create({
            data: {
              productId: product.id,
              name: v.name,
              sku: v.sku ?? null,
              priceDelta: new Prisma.Decimal(v.priceDelta),
              position: v.position || i,
            },
          });
          await tx.toumaInventory.create({ data: { productId: product.id, variantId: variant.id, quantity: v.quantity } });
        }
      } else {
        await tx.toumaInventory.create({ data: { productId: product.id, variantId: null, quantity: input.quantity } });
      }
      return product;
    });
  },

  async update(productId: string, user: ToumaRequestUser, input: UpdateProductInput) {
    const existing = await this.requireOwned(productId, user);
    if (input.categoryId) {
      const category = await prisma.toumaCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw badRequest('Catégorie inconnue.');
    }
    if (input.countryCode) {
      const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
      if (!country || !country.active) throw badRequest(`Pays « ${input.countryCode} » non desservi.`);
    }
    const data: Prisma.ToumaProductUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.brand !== undefined) data.brand = input.brand;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.price !== undefined) data.price = new Prisma.Decimal(input.price);
    if (input.compareAtPrice !== undefined) data.compareAtPrice = new Prisma.Decimal(input.compareAtPrice);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.minOrderQty !== undefined) data.minOrderQty = input.minOrderQty;
    if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
    if (input.keywords !== undefined) data.keywords = input.keywords;
    if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
    if (input.countryCode !== undefined) data.country = { connect: { code: input.countryCode } };
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'ACTIVE' && !existing.publishedAt) data.publishedAt = new Date();
    }

    return prisma.$transaction(async (tx) => {
      const product = await tx.toumaProduct.update({ where: { id: productId }, data });
      if (input.images) {
        await tx.toumaProductImage.deleteMany({ where: { productId } });
        await tx.toumaProductImage.createMany({
          data: input.images.map((img, i) => ({ productId, url: img.url, alt: img.alt ?? null, position: img.position || i })),
        });
      }
      if (input.quantity !== undefined) {
        // Stock du produit simple (variante nulle). Prisma n'accepte pas `null`
        // dans une clé composée : on cherche puis on crée/actualise.
        const inventory = await tx.toumaInventory.findFirst({ where: { productId, variantId: null } });
        if (inventory) {
          await tx.toumaInventory.update({ where: { id: inventory.id }, data: { quantity: input.quantity } });
        } else {
          await tx.toumaInventory.create({ data: { productId, variantId: null, quantity: input.quantity } });
        }
      }
      return product;
    });
  },

  /**
   * Archivage (suppression douce). Une suppression dure casserait l'historique
   * des commandes : on archive, le produit disparaît du catalogue public.
   */
  async archive(productId: string, user: ToumaRequestUser) {
    await this.requireOwned(productId, user);
    return prisma.toumaProduct.update({ where: { id: productId }, data: { status: 'ARCHIVED' } });
  },

  /** Mise à jour directe du stock (seller center). */
  async setStock(productId: string, user: ToumaRequestUser, input: { variantId?: string | null; quantity: number }) {
    await this.requireOwned(productId, user);
    const variantId = input.variantId ?? null;
    const existing = await prisma.toumaInventory.findFirst({ where: { productId, variantId } });
    if (existing) {
      return prisma.toumaInventory.update({ where: { id: existing.id }, data: { quantity: input.quantity } });
    }
    return prisma.toumaInventory.create({ data: { productId, variantId, quantity: input.quantity } });
  },
};
