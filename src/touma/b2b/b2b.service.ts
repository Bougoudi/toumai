import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertSameCurrency, sum } from '../lib/money.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { CreateQuoteInput, CreateRfqInput, ListRfqsQuery } from './b2b.schema.js';

/**
 * TOUMA BUSINESS — appels d'offres (RFQ), devis fournisseurs et négociation.
 *
 * Le parcours réel du commerce B2B africain :
 *   « je recherche 500 kg de cacao au Cameroun »
 *      → les fournisseurs répondent avec un prix, un délai et une validité
 *      → l'acheteur compare, négocie, puis accepte
 *      → l'offre acceptée devient une commande payable comme n'importe quelle autre.
 *
 * Rien n'est inventé : les fournisseurs, prix et délais viennent des vendeurs
 * eux-mêmes.
 */

function reference(prefix: string): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Vue publique d'un appel d'offres (ce qu'un fournisseur peut voir). */
const rfqInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
  buyer: { select: { id: true, name: true, countryCode: true } },
  business: { select: { id: true, legalName: true, sector: true, countryCode: true, city: true } },
  _count: { select: { quotes: true } },
};

function serializeRfq(rfq: Prisma.ToumaRfqGetPayload<{ include: typeof rfqInclude }>) {
  return {
    id: rfq.id,
    reference: rfq.reference,
    title: rfq.title,
    description: rfq.description,
    countryCode: rfq.countryCode,
    city: rfq.city,
    sourceCountry: rfq.sourceCountry,
    currency: rfq.currency,
    status: rfq.status,
    deadline: rfq.deadline,
    createdAt: rfq.createdAt,
    quoteCount: rfq._count.quotes,
    buyer: { name: rfq.buyer.name, countryCode: rfq.buyer.countryCode },
    business: rfq.business,
    items: rfq.items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      targetUnitPrice: i.targetUnitPrice?.toString() ?? null,
    })),
  };
}

function serializeQuote(quote: Prisma.ToumaQuoteGetPayload<{
  include: {
    items: true;
    store: { select: { id: true; name: true; slug: true; countryCode: true; verificationStatus: true; ratingAverage: true; ratingCount: true } };
    negotiations: { include: { author: { select: { id: true; name: true } } } };
  };
}>) {
  return {
    id: quote.id,
    reference: quote.reference,
    status: quote.status,
    currency: quote.currency,
    itemsTotal: quote.itemsTotal.toString(),
    shippingTotal: quote.shippingTotal.toString(),
    total: quote.total.toString(),
    leadTimeDays: quote.leadTimeDays,
    validUntil: quote.validUntil,
    expired: quote.validUntil.getTime() < Date.now(),
    message: quote.message,
    orderGroupId: quote.orderGroupId,
    createdAt: quote.createdAt,
    store: quote.store,
    items: quote.items.map((i) => ({
      id: i.id,
      rfqItemId: i.rfqItemId,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice.toString(),
      lineTotal: i.lineTotal.toString(),
    })),
    negotiations: quote.negotiations.map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      proposedTotal: n.proposedTotal?.toString() ?? null,
      author: n.author,
      createdAt: n.createdAt,
    })),
  };
}

export const b2bService = {
  // ── Profil entreprise ────────────────────────────────────────────────────
  async getProfile(userId: string) {
    return prisma.toumaBusinessProfile.findUnique({ where: { userId } });
  },

  /** Crée ou met à jour le profil entreprise de l'utilisateur courant. */
  async saveProfile(user: ToumaRequestUser, input: Record<string, unknown> & { countryCode: string }) {
    const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
    if (!country || !country.active) throw badRequest(`Pays « ${input.countryCode} » non desservi.`);

    const profile = await prisma.toumaBusinessProfile.upsert({
      where: { userId: user.id },
      update: input,
      create: { ...(input as object), userId: user.id } as Prisma.ToumaBusinessProfileUncheckedCreateInput,
    });
    await audit({ actorId: user.id, action: 'business.profile.save', entity: 'ToumaBusinessProfile', entityId: profile.id });
    return profile;
  },

  // ── Appels d'offres ──────────────────────────────────────────────────────
  /**
   * Publie un appel d'offres. Un profil entreprise n'est pas obligatoire, mais
   * il est rattaché s'il existe : les fournisseurs savent à qui ils répondent.
   */
  async createRfq(user: ToumaRequestUser, input: CreateRfqInput) {
    const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
    if (!country || !country.active || !country.buyingEnabled) {
      throw badRequest(`Livraison non disponible vers « ${input.countryCode} » pour l'instant.`);
    }
    if (input.deadline && new Date(input.deadline).getTime() < Date.now()) {
      throw badRequest('La date limite doit être dans le futur.');
    }
    const business = await prisma.toumaBusinessProfile.findUnique({ where: { userId: user.id } });

    const rfq = await prisma.toumaRfq.create({
      data: {
        reference: reference('RFQ'),
        buyerId: user.id,
        businessProfileId: business?.id ?? null,
        title: input.title,
        description: input.description,
        countryCode: input.countryCode,
        city: input.city ?? null,
        sourceCountry: input.sourceCountry ?? null,
        currency: input.currency,
        deadline: input.deadline ? new Date(input.deadline) : null,
        items: {
          create: input.items.map((i) => ({
            name: i.name,
            description: i.description ?? null,
            quantity: i.quantity,
            unit: i.unit,
            targetUnitPrice: i.targetUnitPrice ? new Prisma.Decimal(i.targetUnitPrice) : null,
            categoryId: i.categoryId ?? null,
          })),
        },
      },
      include: rfqInclude,
    });
    await audit({ actorId: user.id, action: 'rfq.create', entity: 'ToumaRfq', entityId: rfq.id, metadata: { items: input.items.length } });
    return serializeRfq(rfq);
  },

  /** Liste : mes appels d'offres, ou ceux auxquels un fournisseur peut répondre. */
  async listRfqs(user: ToumaRequestUser | undefined, query: ListRfqsQuery) {
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };

    const where: Prisma.ToumaRfqWhereInput =
      query.scope === 'mine'
        ? { buyerId: user?.id ?? '__anonyme__', ...(query.status ? { status: query.status } : {}) }
        : {
            status: query.status ?? { in: ['OPEN', 'QUOTED'] },
            ...(query.country ? { countryCode: query.country } : {}),
            ...(query.q
              ? {
                  OR: [
                    { title: { contains: query.q, mode: 'insensitive' as const } },
                    { description: { contains: query.q, mode: 'insensitive' as const } },
                    { items: { some: { name: { contains: query.q, mode: 'insensitive' as const } } } },
                  ],
                }
              : {}),
          };

    const [rows, total] = await Promise.all([
      prisma.toumaRfq.findMany({ where, include: rfqInclude, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.limit }),
      prisma.toumaRfq.count({ where }),
    ]);
    return paginated(rows.map(serializeRfq), total, page);
  },

  /**
   * Détail d'un appel d'offres. L'acheteur voit toutes les offres reçues ; un
   * fournisseur ne voit que la sienne (les prix concurrents restent secrets).
   */
  async getRfq(user: ToumaRequestUser | undefined, rfqId: string) {
    const rfq = await prisma.toumaRfq.findFirst({
      where: { OR: [{ id: rfqId }, { reference: rfqId }] },
      include: rfqInclude,
    });
    if (!rfq) throw notFound('Appel d’offres introuvable.');

    const isOwner = user?.id === rfq.buyerId;
    const isAdmin = user?.role === 'ADMIN';

    const quoteInclude = {
      items: true,
      store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
      negotiations: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
    };

    const quotes =
      isOwner || isAdmin
        ? await prisma.toumaQuote.findMany({ where: { rfqId: rfq.id }, include: quoteInclude, orderBy: { total: 'asc' } })
        : user
          ? await prisma.toumaQuote.findMany({ where: { rfqId: rfq.id, sellerId: user.id }, include: quoteInclude })
          : [];

    return {
      ...serializeRfq(rfq),
      isOwner,
      /** Un fournisseur ne voit jamais les offres de ses concurrents. */
      quotes: quotes.map(serializeQuote),
    };
  },

  /** Clôture d'un appel d'offres par son auteur. */
  async closeRfq(user: ToumaRequestUser, rfqId: string) {
    const rfq = await prisma.toumaRfq.findUnique({ where: { id: rfqId } });
    if (!rfq) throw notFound('Appel d’offres introuvable.');
    if (rfq.buyerId !== user.id && user.role !== 'ADMIN') throw forbidden('Seul l’auteur peut clore cet appel d’offres.');
    if (['AWARDED', 'CLOSED', 'CANCELLED'].includes(rfq.status)) throw conflict('Cet appel d’offres est déjà clos.');

    const updated = await prisma.toumaRfq.update({ where: { id: rfq.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await audit({ actorId: user.id, action: 'rfq.close', entity: 'ToumaRfq', entityId: rfq.id });
    return updated;
  },

  // ── Offres fournisseurs ──────────────────────────────────────────────────
  /** Un vendeur répond à un appel d'offres (une seule offre par boutique). */
  async createQuote(user: ToumaRequestUser, rfqId: string, input: CreateQuoteInput) {
    const rfq = await prisma.toumaRfq.findUnique({ where: { id: rfqId }, include: { items: true } });
    if (!rfq) throw notFound('Appel d’offres introuvable.');
    if (!['OPEN', 'QUOTED'].includes(rfq.status)) throw conflict('Cet appel d’offres n’accepte plus d’offres.');
    if (rfq.deadline && rfq.deadline.getTime() < Date.now()) throw conflict('La date limite de cet appel d’offres est dépassée.');
    if (rfq.buyerId === user.id) throw badRequest('Vous ne pouvez pas répondre à votre propre appel d’offres.');

    const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id) throw forbidden('Vous ne pouvez proposer une offre que depuis votre propre boutique.');
    if (store.status !== 'ACTIVE') throw conflict('Votre boutique doit être active pour répondre.');

    const existing = await prisma.toumaQuote.findUnique({ where: { rfqId_storeId: { rfqId: rfq.id, storeId: store.id } } });
    if (existing) throw conflict('Votre boutique a déjà répondu à cet appel d’offres.');

    // Chaque ligne chiffrée doit correspondre à une ligne demandée.
    for (const item of input.items) {
      if (item.rfqItemId && !rfq.items.some((r) => r.id === item.rfqItemId)) {
        throw badRequest('Une ligne de votre offre ne correspond à aucune ligne demandée.');
      }
    }

    const lines = input.items.map((i) => ({
      ...i,
      lineTotal: new Prisma.Decimal(i.unitPrice).times(i.quantity),
    }));
    const itemsTotal = sum(lines.map((l) => l.lineTotal));
    const shippingTotal = new Prisma.Decimal(input.shippingTotal);
    const validUntil = new Date(Date.now() + input.validityDays * 24 * 3600 * 1000);

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaQuote.create({
        data: {
          reference: reference('QT'),
          rfqId: rfq.id,
          storeId: store.id,
          sellerId: user.id,
          currency: rfq.currency,
          itemsTotal,
          shippingTotal,
          total: itemsTotal.plus(shippingTotal),
          leadTimeDays: input.leadTimeDays,
          validUntil,
          message: input.message ?? null,
          items: {
            create: lines.map((l) => ({
              rfqItemId: l.rfqItemId ?? null,
              name: l.name,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: new Prisma.Decimal(l.unitPrice),
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: {
          items: true,
          store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
          negotiations: { include: { author: { select: { id: true, name: true } } } },
        },
      });
      if (rfq.status === 'OPEN') await tx.toumaRfq.update({ where: { id: rfq.id }, data: { status: 'QUOTED' } });
      return created;
    });

    await Promise.all([
      notify({
        userId: rfq.buyerId,
        type: 'ORDER_STATUS_CHANGED',
        title: 'Nouvelle offre reçue',
        body: `${store.name} a répondu à votre appel d’offres ${rfq.reference}.`,
        data: { rfqId: rfq.id, quoteId: quote.id },
      }),
      audit({ actorId: user.id, action: 'quote.create', entity: 'ToumaQuote', entityId: quote.id, metadata: { rfqId: rfq.id } }),
    ]);
    return serializeQuote(quote);
  },

  /** Offres émises par les boutiques du vendeur connecté. */
  async listMyQuotes(user: ToumaRequestUser) {
    const quotes = await prisma.toumaQuote.findMany({
      where: { sellerId: user.id },
      include: {
        items: true,
        store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
        negotiations: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        rfq: { select: { id: true, reference: true, title: true, status: true, countryCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return quotes.map((q) => ({ ...serializeQuote(q), rfq: q.rfq }));
  },

  /**
   * Message ou contre-proposition sur une offre. Seuls l'acheteur et le
   * fournisseur concernés participent ; tout est conservé (l'historique fait foi).
   */
  async negotiate(user: ToumaRequestUser, quoteId: string, input: { kind: 'MESSAGE' | 'COUNTER_OFFER'; body: string; proposedTotal?: string }) {
    const quote = await prisma.toumaQuote.findUnique({ where: { id: quoteId }, include: { rfq: true } });
    if (!quote) throw notFound('Offre introuvable.');

    const isBuyer = quote.rfq.buyerId === user.id;
    const isSeller = quote.sellerId === user.id;
    if (!isBuyer && !isSeller && user.role !== 'ADMIN') throw notFound('Offre introuvable.');
    if (['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(quote.status)) throw conflict('Cette offre est close : la négociation est terminée.');
    if (quote.validUntil.getTime() < Date.now()) throw conflict('Cette offre a expiré.');

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaNegotiationMessage.create({
        data: {
          quoteId: quote.id,
          authorId: user.id,
          kind: input.kind,
          body: input.body,
          proposedTotal: input.proposedTotal ? new Prisma.Decimal(input.proposedTotal) : null,
        },
      });
      if (input.kind === 'COUNTER_OFFER') {
        // Une contre-proposition du **vendeur** ajuste le prix de son offre.
        // Une contre-proposition de l'acheteur reste une demande à accepter.
        await tx.toumaQuote.update({
          where: { id: quote.id },
          data: {
            status: 'COUNTERED',
            ...(isSeller && input.proposedTotal
              ? { total: new Prisma.Decimal(input.proposedTotal), itemsTotal: new Prisma.Decimal(input.proposedTotal).minus(quote.shippingTotal) }
              : {}),
          },
        });
      }
      return created;
    });

    await notify({
      userId: isBuyer ? quote.sellerId : quote.rfq.buyerId,
      type: 'ORDER_STATUS_CHANGED',
      title: input.kind === 'COUNTER_OFFER' ? 'Contre-proposition reçue' : 'Nouveau message sur une offre',
      body: `Offre ${quote.reference} — ${input.body.slice(0, 120)}`,
      data: { quoteId: quote.id, rfqId: quote.rfqId },
    });
    return {
      id: message.id,
      kind: message.kind,
      body: message.body,
      proposedTotal: message.proposedTotal?.toString() ?? null,
      createdAt: message.createdAt,
    };
  },

  /**
   * Acceptation d'une offre par l'acheteur : elle devient une commande réelle
   * (groupe + sous-commande du vendeur), payable comme n'importe quelle autre.
   * Les lignes sont figées à partir de l'offre : elles ne dépendent pas du
   * catalogue, un accord B2B portant souvent sur des lots sur mesure.
   */
  async acceptQuote(user: ToumaRequestUser, quoteId: string, addressId: string) {
    const quote = await prisma.toumaQuote.findUnique({
      where: { id: quoteId },
      include: { rfq: true, items: true, store: true },
    });
    if (!quote) throw notFound('Offre introuvable.');
    if (quote.rfq.buyerId !== user.id) throw forbidden('Seul l’auteur de l’appel d’offres peut accepter une offre.');
    if (quote.status === 'ACCEPTED') throw conflict('Cette offre a déjà été acceptée.');
    if (['REJECTED', 'WITHDRAWN', 'EXPIRED'].includes(quote.status)) throw conflict('Cette offre n’est plus valable.');
    if (quote.validUntil.getTime() < Date.now()) throw conflict('Cette offre a expiré : demandez au fournisseur de la renouveler.');

    const address = await prisma.toumaAddress.findFirst({ where: { id: addressId, userId: user.id }, include: { country: true } });
    if (!address) throw notFound('Adresse de livraison introuvable.');
    assertSameCurrency(quote.currency, quote.rfq.currency);

    const shippingSnapshot = {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      district: address.district,
      landmark: address.landmark,
      instructions: address.instructions,
      city: address.city,
      countryCode: address.countryCode,
      deliveryMethod: 'HOME',
    };

    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.toumaOrderGroup.create({
        data: {
          reference: reference('TMG'),
          buyerId: user.id,
          currency: quote.currency,
          itemsTotal: quote.itemsTotal,
          shippingTotal: quote.shippingTotal,
          total: quote.total,
          shippingSnapshot: shippingSnapshot as object,
          crossBorder: address.countryCode !== quote.store.countryCode,
        },
      });

      const commissionRate = new Prisma.Decimal(String(process.env.TOUMA_COMMISSION_RATE ?? 0.05));
      const order = await tx.toumaOrder.create({
        data: {
          orderNumber: reference('TM'),
          groupId: group.id,
          buyerId: user.id,
          storeId: quote.storeId,
          currency: quote.currency,
          subtotal: quote.itemsTotal,
          shippingTotal: quote.shippingTotal,
          commissionTotal: quote.itemsTotal.times(commissionRate).toDecimalPlaces(4),
          total: quote.total,
          shippingAddressId: address.id,
          shippingSnapshot: shippingSnapshot as object,
          crossBorder: address.countryCode !== quote.store.countryCode,
          buyerCountry: address.countryCode,
          sellerCountry: quote.store.countryCode,
          note: `Issue de l'offre ${quote.reference} (appel d'offres ${quote.rfq.reference}).`,
          items: {
            create: quote.items.map((i) => ({
              titleSnapshot: `${i.name} — ${i.quantity} ${i.unit}`,
              variantSnapshot: null,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              lineTotal: i.lineTotal,
              currency: quote.currency,
            })),
          },
        },
      });

      await tx.toumaQuote.update({
        where: { id: quote.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), orderGroupId: group.id },
      });
      // Les offres concurrentes sont refusées : l'appel d'offres est attribué.
      await tx.toumaQuote.updateMany({
        where: { rfqId: quote.rfqId, id: { not: quote.id }, status: { in: ['SUBMITTED', 'COUNTERED'] } },
        data: { status: 'REJECTED' },
      });
      await tx.toumaRfq.update({ where: { id: quote.rfqId }, data: { status: 'AWARDED', closedAt: new Date() } });
      await tx.toumaNegotiationMessage.create({
        data: { quoteId: quote.id, authorId: user.id, kind: 'ACCEPT', body: 'Offre acceptée : commande créée.' },
      });

      return { group, order };
    });

    await Promise.all([
      notify({
        userId: quote.sellerId,
        type: 'NEW_ORDER_FOR_SELLER',
        title: 'Offre acceptée',
        body: `Votre offre ${quote.reference} a été acceptée : commande ${created.order.orderNumber} en attente de paiement.`,
        data: { quoteId: quote.id, orderId: created.order.id },
      }),
      audit({
        actorId: user.id,
        action: 'quote.accept',
        entity: 'ToumaQuote',
        entityId: quote.id,
        metadata: { rfqId: quote.rfqId, orderGroupId: created.group.id, total: quote.total.toString() },
      }),
    ]);

    return {
      quoteId: quote.id,
      orderGroupId: created.group.id,
      orderId: created.order.id,
      orderNumber: created.order.orderNumber,
      total: created.group.total.toString(),
      currency: created.group.currency,
    };
  },

  /** Refus explicite d'une offre par l'acheteur. */
  async rejectQuote(user: ToumaRequestUser, quoteId: string, reason?: string) {
    const quote = await prisma.toumaQuote.findUnique({ where: { id: quoteId }, include: { rfq: true } });
    if (!quote) throw notFound('Offre introuvable.');
    if (quote.rfq.buyerId !== user.id) throw forbidden('Seul l’auteur de l’appel d’offres peut refuser une offre.');
    if (['ACCEPTED', 'REJECTED'].includes(quote.status)) throw conflict('Cette offre est déjà tranchée.');

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.toumaQuote.update({ where: { id: quote.id }, data: { status: 'REJECTED' } });
      await tx.toumaNegotiationMessage.create({
        data: { quoteId: quote.id, authorId: user.id, kind: 'REJECT', body: reason ?? 'Offre non retenue.' },
      });
      return q;
    });
    await notify({
      userId: quote.sellerId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Offre non retenue',
      body: `Votre offre ${quote.reference} n’a pas été retenue.`,
      data: { quoteId: quote.id },
    });
    return { id: updated.id, status: updated.status };
  },
};
