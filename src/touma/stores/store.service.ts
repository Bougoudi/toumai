import type { StoreStatus, ToumaOrderStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { uniqueSlug } from '../lib/slug.js';
import { pageParams, paginated } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/** Statuts de commande comptés comme une vente réalisée. */
const PAID_STATUSES: ToumaOrderStatus[] = ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

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
  /// Où se trouve la boutique. Un acheteur de Moundou veut le savoir avant le
  /// prix : la province décide du délai et, souvent, de la possibilité même de
  /// livrer.
  province: { select: { id: true, code: true, name: true, nameAr: true } },
  locality: { select: { id: true, name: true, nameAr: true } },
  status: true,
  verificationStatus: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
} as const;

export const storeService = {
  /** Liste publique : uniquement les boutiques actives. */
  /**
   * Liste publique : uniquement les boutiques actives.
   *
   * Le filtre par province (§12) répond à « vendeurs au Ouaddaï », « vendeurs à
   * N'Djamena ». Il accepte aussi bien l'identifiant que le code officiel de la
   * province, parce qu'une page publique comme `/chad/ouaddai` connaît le code,
   * pas l'identifiant interne.
   *
   * **Il n'exclut jamais personne.** Le §14 est explicite : la proximité est un
   * ordre de présentation, pas un mur. Sans filtre demandé, toutes les
   * boutiques du pays sont rendues — un vendeur de Sarh reste visible pour un
   * acheteur d'Abéché.
   */
  async list(query: {
    q?: string;
    country?: string;
    verified?: string;
    province?: string;
    locality?: string;
    page?: unknown;
    limit?: unknown;
  }) {
    const page = pageParams(query);
    const where = {
      status: 'ACTIVE' as StoreStatus,
      ...(query.country ? { countryCode: query.country.toUpperCase() } : {}),
      ...(query.verified === 'true' ? { verificationStatus: 'APPROVED' as const } : {}),
      ...(query.province
        ? { province: { OR: [{ id: query.province }, { code: query.province }] } }
        : {}),
      ...(query.locality ? { localityId: query.locality } : {}),
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

  /** Fiche publique par id ou slug (avec ventes réalisées et produits actifs). */
  async get(idOrSlug: string) {
    const store = await prisma.toumaStore.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: {
        ...publicSelect,
        _count: {
          select: {
            products: { where: { status: 'ACTIVE' } },
            // Ventes = commandes réellement payées, jamais les paniers abandonnés.
            orders: { where: { status: { in: PAID_STATUSES } } },
          },
        },
      },
    });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');
    return { ...store, productCount: store._count.products, salesCount: store._count.orders, _count: undefined };
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
