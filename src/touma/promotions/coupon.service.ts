import { Prisma, type DiscountFunding, type ToumaCoupon } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertSameCurrency, money, roundTo, sum, ZERO } from '../lib/money.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { CreateCouponInput, ListCouponsQuery, UpdateCouponInput } from './coupon.schema.js';

/**
 * PROMOTIONS — codes de réduction.
 *
 * Une règle structure tout le module : **qui finance la remise**.
 *   • `PLATFORM` — campagne TOUMA. Le vendeur est payé plein tarif et sa
 *     commission reste calculée sur le sous-total avant remise : la plateforme
 *     paie sa propre promotion.
 *   • `STORE` — promotion du vendeur, qui réduit son propre revenu, et donc
 *     aussi la commission assise dessus.
 *
 * Le calcul est volontairement une **fonction pure** (`computeDiscount`) :
 * l'aperçu affiché à l'acheteur et le montant réellement débité au checkout
 * sortent du même code, ils ne peuvent pas diverger.
 */

/** Une ligne de panier agrégée par boutique. */
export interface BasketStoreLine {
  storeId: string;
  subtotal: Prisma.Decimal;
  shipping: Prisma.Decimal;
  currency: string;
}

export interface DiscountAllocation {
  /** Remise totale accordée, jamais supérieure à la base éligible. */
  total: Prisma.Decimal;
  /** Part imputée à chaque boutique (la somme est exactement `total`). */
  byStore: Map<string, Prisma.Decimal>;
  funding: DiscountFunding;
  /** La remise porte-t-elle sur la livraison plutôt que sur la marchandise ? */
  onShipping: boolean;
  currency: string;
  label: string;
}

/**
 * Répartit un montant sur des bases, au prorata, **sans perdre ni créer de
 * centime** : la dernière part absorbe le reste de l'arrondi.
 */
function allocate(amount: Prisma.Decimal, bases: Array<{ key: string; base: Prisma.Decimal }>, currency: string): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  const totalBase = sum(bases.map((b) => b.base));
  if (!totalBase.greaterThan(0)) return out;

  const eligible = bases.filter((b) => b.base.greaterThan(0));
  let distributed = ZERO;
  eligible.forEach((entry, index) => {
    const isLast = index === eligible.length - 1;
    const share = isLast ? amount.minus(distributed) : roundTo(amount.times(entry.base).dividedBy(totalBase), currency);
    distributed = distributed.plus(share);
    out.set(entry.key, share);
  });
  return out;
}

/** Raison pour laquelle un code ne s'applique pas — message destiné à l'acheteur. */
function unusable(reason: string): never {
  throw badRequest(reason);
}

/**
 * Vérifie qu'un code est utilisable par cet acheteur sur ce panier, puis
 * calcule la remise et sa répartition. Lève une 400 explicite sinon.
 */
export async function computeDiscount(options: {
  coupon: ToumaCoupon;
  userId: string;
  lines: BasketStoreLine[];
  destinationCountry: string;
  /** Le nombre de commandes déjà passées, pour la règle « première commande ». */
  previousOrderCount: number;
  /** Utilisations déjà faites par cet acheteur. */
  userRedemptions: number;
}): Promise<DiscountAllocation> {
  const { coupon, lines, destinationCountry } = options;
  if (lines.length === 0) unusable('Votre panier est vide.');

  const currency = lines[0].currency;
  for (const line of lines) assertSameCurrency(line.currency, currency);

  if (coupon.status !== 'ACTIVE') unusable('Ce code n’est plus actif.');
  const now = Date.now();
  if (coupon.startsAt.getTime() > now) unusable('Ce code n’est pas encore valable.');
  if (coupon.endsAt && coupon.endsAt.getTime() < now) unusable('Ce code a expiré.');
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) unusable('Ce code a atteint sa limite d’utilisation.');
  if (coupon.usageLimitPerUser !== null && options.userRedemptions >= coupon.usageLimitPerUser) {
    unusable('Vous avez déjà utilisé ce code.');
  }
  if (coupon.firstOrderOnly && options.previousOrderCount > 0) unusable('Ce code est réservé à une première commande.');
  if (coupon.countryCodes) {
    const allowed = coupon.countryCodes.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(destinationCountry.toUpperCase())) {
      unusable('Ce code ne s’applique pas au pays de livraison choisi.');
    }
  }
  // Un montant fixe est libellé dans une devise : l'appliquer à un panier d'une
  // autre devise reviendrait à inventer un taux de change.
  if (coupon.currency) assertSameCurrency(coupon.currency, currency);

  // Périmètre : un code de boutique ne touche que les lignes de cette boutique.
  const scoped = coupon.storeId ? lines.filter((l) => l.storeId === coupon.storeId) : lines;
  if (scoped.length === 0) unusable('Ce code ne s’applique à aucun article de votre panier.');

  const onShipping = coupon.type === 'FREE_SHIPPING';
  const bases = scoped.map((l) => ({ key: l.storeId, base: onShipping ? l.shipping : l.subtotal }));
  const base = sum(bases.map((b) => b.base));

  if (coupon.minOrderAmount) {
    // Le minimum porte toujours sur la marchandise, jamais sur le transport.
    const merchandise = sum(scoped.map((l) => l.subtotal));
    if (merchandise.lessThan(coupon.minOrderAmount)) {
      unusable(`Ce code demande un minimum de ${coupon.minOrderAmount.toString()} ${currency} d’achat.`);
    }
  }
  if (!base.greaterThan(0)) unusable('Ce code ne réduit rien sur ce panier.');

  let raw: Prisma.Decimal;
  let label: string;
  if (coupon.type === 'PERCENTAGE') {
    raw = roundTo(base.times(coupon.value).dividedBy(100), currency);
    label = `−${coupon.value.toString()} %`;
  } else if (coupon.type === 'FIXED_AMOUNT') {
    raw = roundTo(money(coupon.value), currency);
    label = `−${coupon.value.toString()} ${currency}`;
  } else {
    raw = base;
    label = 'Livraison offerte';
  }

  if (coupon.maxDiscountAmount && raw.greaterThan(coupon.maxDiscountAmount)) {
    raw = roundTo(money(coupon.maxDiscountAmount), currency);
  }
  // Garde-fou final : une remise ne dépasse jamais ce sur quoi elle porte.
  const total = raw.greaterThan(base) ? base : raw;

  return {
    total,
    byStore: allocate(total, bases, currency),
    funding: coupon.funding,
    onShipping,
    currency,
    label,
  };
}

/** Charge un code par sa valeur saisie (insensible à la casse). */
export async function findCoupon(code: string) {
  return prisma.toumaCoupon.findUnique({ where: { code: code.toUpperCase() } });
}

/**
 * Statut tel qu'il est vécu par l'acheteur. Un code dont la date est passée est
 * refusé au checkout : l'afficher « actif » dans la liste serait un mensonge,
 * alors qu'aucune tâche de fond ne repasse sur les codes expirés.
 */
function effectiveStatus(coupon: ToumaCoupon): ToumaCoupon['status'] {
  if (coupon.status !== 'ACTIVE') return coupon.status;
  if (coupon.endsAt && coupon.endsAt.getTime() < Date.now()) return 'EXPIRED';
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) return 'EXHAUSTED';
  return 'ACTIVE';
}

function serialize(coupon: ToumaCoupon & { _count?: { redemptions: number } }) {
  return {
    id: coupon.id,
    code: coupon.code,
    funding: coupon.funding,
    storeId: coupon.storeId,
    type: coupon.type,
    value: coupon.value.toString(),
    currency: coupon.currency,
    description: coupon.description,
    minOrderAmount: coupon.minOrderAmount?.toString() ?? null,
    maxDiscountAmount: coupon.maxDiscountAmount?.toString() ?? null,
    countryCodes: coupon.countryCodes ? coupon.countryCodes.split(',').filter(Boolean) : [],
    firstOrderOnly: coupon.firstOrderOnly,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    usageLimit: coupon.usageLimit,
    usageLimitPerUser: coupon.usageLimitPerUser,
    usageCount: coupon.usageCount,
    status: effectiveStatus(coupon),
    redemptionCount: coupon._count?.redemptions,
    createdAt: coupon.createdAt,
  };
}

export const couponService = {
  computeDiscount,
  findCoupon,

  /**
   * Crée un code. Un vendeur ne crée que des codes de **ses** boutiques, et
   * ceux-ci sont forcément financés par la boutique : sans ce garde-fou, un
   * vendeur pourrait créer des promotions payées par TOUMA.
   */
  async create(user: ToumaRequestUser, input: CreateCouponInput) {
    let funding: DiscountFunding = 'PLATFORM';
    if (input.storeId) {
      const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId }, select: { id: true, ownerId: true } });
      if (!store) throw notFound('Boutique introuvable.');
      if (store.ownerId !== user.id && user.role !== 'ADMIN') throw notFound('Boutique introuvable.');
      funding = 'STORE';
    } else if (user.role !== 'ADMIN') {
      throw forbidden('Seule l’administration TOUMA crée des promotions à l’échelle de la place de marché.');
    }

    const existing = await prisma.toumaCoupon.findUnique({ where: { code: input.code } });
    if (existing) throw conflict('Ce code existe déjà.');

    const coupon = await prisma.toumaCoupon.create({
      data: {
        code: input.code,
        funding,
        storeId: input.storeId ?? null,
        type: input.type,
        value: input.value ? new Prisma.Decimal(input.value) : new Prisma.Decimal(0),
        currency: input.currency ?? null,
        description: input.description,
        minOrderAmount: input.minOrderAmount ? new Prisma.Decimal(input.minOrderAmount) : null,
        maxDiscountAmount: input.maxDiscountAmount ? new Prisma.Decimal(input.maxDiscountAmount) : null,
        countryCodes: input.countryCodes.join(','),
        firstOrderOnly: input.firstOrderOnly,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        usageLimit: input.usageLimit ?? null,
        usageLimitPerUser: input.usageLimitPerUser ?? null,
        createdById: user.id,
      },
    });
    await audit({ actorId: user.id, action: 'coupon.create', entity: 'ToumaCoupon', entityId: coupon.id, metadata: { code: coupon.code, funding } });
    return serialize(coupon);
  },

  async list(user: ToumaRequestUser, query: ListCouponsQuery) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    if (query.scope === 'platform' && user.role !== 'ADMIN') throw forbidden('Réservé à l’administration.');

    const where: Prisma.ToumaCouponWhereInput =
      query.scope === 'platform'
        ? { storeId: null, ...(query.status ? { status: query.status } : {}) }
        : {
            store: user.role === 'ADMIN' && query.storeId ? { id: query.storeId } : { ownerId: user.id, ...(query.storeId ? { id: query.storeId } : {}) },
            ...(query.status ? { status: query.status } : {}),
          };

    const [rows, total] = await Promise.all([
      prisma.toumaCoupon.findMany({ where, include: { _count: { select: { redemptions: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaCoupon.count({ where }),
    ]);
    return paginated(rows.map(serialize), total, page);
  },

  async update(user: ToumaRequestUser, id: string, input: UpdateCouponInput) {
    const coupon = await prisma.toumaCoupon.findUnique({ where: { id }, include: { store: { select: { ownerId: true } } } });
    if (!coupon) throw notFound('Code introuvable.');
    const owns = coupon.store ? coupon.store.ownerId === user.id : false;
    if (!owns && user.role !== 'ADMIN') throw notFound('Code introuvable.');

    const updated = await prisma.toumaCoupon.update({
      where: { id: coupon.id },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
      },
    });
    await audit({ actorId: user.id, action: 'coupon.update', entity: 'ToumaCoupon', entityId: coupon.id, metadata: { ...input } });
    return serialize(updated);
  },

  /** Utilisations d'un code — ce qu'il a réellement coûté. */
  async redemptions(user: ToumaRequestUser, id: string) {
    const coupon = await prisma.toumaCoupon.findUnique({ where: { id }, include: { store: { select: { ownerId: true } } } });
    if (!coupon) throw notFound('Code introuvable.');
    const owns = coupon.store ? coupon.store.ownerId === user.id : false;
    if (!owns && user.role !== 'ADMIN') throw notFound('Code introuvable.');

    const rows = await prisma.toumaCouponRedemption.findMany({
      where: { couponId: coupon.id },
      include: { orderGroup: { select: { reference: true, total: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      coupon: serialize(coupon),
      totalGranted: sum(rows.map((r) => r.amount)).toString(),
      items: rows.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        currency: r.currency,
        orderGroup: { reference: r.orderGroup.reference, total: r.orderGroup.total.toString() },
        createdAt: r.createdAt,
      })),
    };
  },
};
