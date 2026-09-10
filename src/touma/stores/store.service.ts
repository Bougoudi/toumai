import type { StoreStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { uniqueSlug } from '../lib/slug.js';
import { pageParams, paginated } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/** Champs publics d'une boutique (aucune donnée privée du vendeur). */
const publicSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  countryCode: true,
  city: true,
  status: true,
  verificationStatus: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
} as const;

export const storeService = {
  /** Liste publique : uniquement les boutiques actives. */
  async list(query: { q?: string; country?: string; verified?: string; page?: unknown; limit?: unknown }) {
    const page = pageParams(query);
    const where = {
      status: 'ACTIVE' as StoreStatus,
      ...(query.country ? { countryCode: query.country.toUpperCase() } : {}),
      ...(query.verified === 'true' ? { verificationStatus: 'APPROVED' as const } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { description: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.toumaStore.findMany({ where, select: publicSelect, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaStore.count({ where }),
    ]);
    return paginated(items, total, page);
  },

  /** Fiche publique par id ou slug. */
  async get(idOrSlug: string) {
    const store = await prisma.toumaStore.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { ...publicSelect, _count: { select: { products: { where: { status: 'ACTIVE' } } } } },
    });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');
    return { ...store, productCount: store._count.products, _count: undefined };
  },

  /** Boutiques du vendeur connecté (vue privée, tous statuts). */
  async mine(userId: string) {
    return prisma.toumaStore.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } });
  },

  /**
   * Création d'une boutique. Le compte passe automatiquement vendeur : un
   * acheteur qui ouvre une boutique devient SELLER (jamais ADMIN).
   */
  async create(user: ToumaRequestUser, input: { name: string; description?: string; countryCode: string; city?: string; phone?: string; logoUrl?: string; bannerUrl?: string }) {
    const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
    if (!country || !country.active || !country.sellingEnabled) {
      throw badRequest(`La vente n'est pas encore ouverte depuis « ${input.countryCode} ».`);
    }
    const existing = await prisma.toumaStore.count({ where: { ownerId: user.id } });
    if (existing >= 5) throw conflict('Limite de boutiques atteinte pour ce compte.');

    const slug = await uniqueSlug(input.name, async (s) => (await prisma.toumaStore.count({ where: { slug: s } })) > 0);
    return prisma.$transaction(async (tx) => {
      const store = await tx.toumaStore.create({
        data: {
          ownerId: user.id,
          name: input.name,
          slug,
          description: input.description ?? null,
          countryCode: country.code,
          city: input.city ?? null,
          phone: input.phone ?? null,
          logoUrl: input.logoUrl ?? null,
          bannerUrl: input.bannerUrl ?? null,
          // Une boutique est visible dès sa création ; la confiance vient de
          // Touma Verified (verificationStatus), pas d'un blocage a priori.
          status: 'ACTIVE',
        },
      });
      if (user.role === 'BUYER') {
        await tx.user.update({ where: { id: user.id }, data: { toumaRole: 'SELLER' } });
      }
      return store;
    });
  },

  /**
   * Chargement d'une boutique dont l'utilisateur doit être propriétaire.
   * Règle stricte : « un vendeur ne peut modifier que sa propre boutique ».
   * L'administrateur peut intervenir (modération), ce qui est audité côté appelant.
   */
  async requireOwned(storeId: string, user: ToumaRequestUser) {
    const store = await prisma.toumaStore.findUnique({ where: { id: storeId } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id && user.role !== 'ADMIN') {
      throw forbidden('Vous ne pouvez agir que sur votre propre boutique.');
    }
    return store;
  },

  async update(storeId: string, user: ToumaRequestUser, input: Record<string, unknown>) {
    await this.requireOwned(storeId, user);
    // Le statut n'est modifiable que par l'administration (suspension/fermeture).
    if (input.status && user.role !== 'ADMIN') delete input.status;
    // Le statut de vérification n'est jamais modifiable directement.
    delete input.verificationStatus;
    delete input.ownerId;
    return prisma.toumaStore.update({ where: { id: storeId }, data: input });
  },
};
