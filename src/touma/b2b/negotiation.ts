import { Prisma, type QuoteStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { multiply, roundTo, sum } from '../lib/money.js';
import { notify } from '../lib/notifications.js';
import { consume, MESSAGING_RULES } from '../lib/throttle.js';
import { systemMessaging } from '../messaging/messaging.service.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Moteur de négociation B2B.
 *
 * Une négociation, c'est une offre et l'histoire de ses révisions. Deux règles
 * gouvernent tout le fichier :
 *
 *  1. **Le serveur calcule.** Le client envoie des quantités, des prix
 *     unitaires et des frais ; il ne propose jamais un total. Ce que
 *     l'acheteur voit est donc exactement ce qu'il paiera.
 *  2. **Une offre acceptée est figée.** Les transitions sont déclarées une
 *     seule fois, ci-dessous, et une transition non prévue est un conflit —
 *     pas un comportement indéfini.
 */

/**
 * Machine d'état d'une offre.
 *
 * `SUBMITTED` est l'état actif (l'offre vit, elle peut être négociée) ;
 * `COUNTERED` signale qu'une contre-proposition est sur la table. Les quatre
 * autres états sont terminaux.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  SUBMITTED: ['COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'],
  COUNTERED: ['COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  WITHDRAWN: [],
};

/** Une offre dans un état terminal ne bouge plus. */
export function isTerminal(status: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[status].length === 0;
}

/** Vérifie une transition ; lève 409 si elle n'est pas prévue. */
export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    throw conflict(`Transition impossible : une offre « ${from} » ne peut pas devenir « ${to} ».`);
  }
}

export interface OfferLineInput {
  rfqItemId?: string | null;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: string;
}

export interface ComputedOffer {
  items: Array<{ rfqItemId: string | null; name: string; quantity: number; unit: string; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }>;
  itemsTotal: Prisma.Decimal;
  shipping: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Calcule une proposition. Fonction pure : c'est elle qui sert d'aperçu au
 * client **et** d'écriture en base — il ne peut donc pas y avoir d'écart entre
 * ce qui est annoncé et ce qui est enregistré.
 */
export function computeOffer(lines: OfferLineInput[], shippingTotal: string, currency: string): ComputedOffer {
  if (lines.length === 0) throw badRequest('Une proposition comporte au moins une ligne.');

  const items = lines.map((l) => {
    const unitPrice = new Prisma.Decimal(l.unitPrice);
    if (unitPrice.isNegative()) throw badRequest('Un prix unitaire ne peut pas être négatif.');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw badRequest('Une quantité est un entier positif.');
    return {
      rfqItemId: l.rfqItemId ?? null,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice,
      lineTotal: roundTo(multiply(unitPrice, l.quantity), currency),
    };
  });

  const shipping = new Prisma.Decimal(shippingTotal);
  if (shipping.isNegative()) throw badRequest('Les frais de livraison ne peuvent pas être négatifs.');

  const itemsTotal = roundTo(sum(items.map((i) => i.lineTotal)), currency);
  return { items, itemsTotal, shipping: roundTo(shipping, currency), total: roundTo(itemsTotal.plus(shipping), currency) };
}

/**
 * Applique l'expiration aux offres dont la validité est dépassée.
 *
 * Idempotent, sans dépendance : appelé à la lecture des négociations et
 * exposable en tâche planifiée. Le frontend n'a jamais le pouvoir de décider
 * qu'une offre a expiré — il ne fait que l'afficher.
 */
export async function expireStaleQuotes(): Promise<number> {
  const { count } = await prisma.toumaQuote.updateMany({
    where: { status: { in: ['SUBMITTED', 'COUNTERED'] }, validUntil: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return count;
}

/** Charge une offre et les droits de l'utilisateur dessus. */
async function loadNegotiation(user: ToumaRequestUser, quoteId: string) {
  const quote = await prisma.toumaQuote.findFirst({
    where: { OR: [{ id: quoteId }, { reference: quoteId }] },
    include: {
      rfq: { select: { id: true, reference: true, title: true, buyerId: true, currency: true, status: true } },
      items: { orderBy: { createdAt: 'asc' } },
      store: { select: { id: true, name: true, slug: true, ownerId: true, countryCode: true, verificationStatus: true, ratingAverage: true, ratingCount: true } },
      negotiations: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!quote) throw notFound('Négociation introuvable.');

  const isBuyer = quote.rfq.buyerId === user.id;
  const isSeller = quote.sellerId === user.id;
  const isAdmin = user.role === 'ADMIN';
  // Anti-IDOR : une négociation d'autrui est « introuvable », pas « interdite ».
  if (!isBuyer && !isSeller && !isAdmin) throw notFound('Négociation introuvable.');
  return { quote, isBuyer, isSeller, isAdmin };
}

/** La proposition la plus récente encore ouverte, quel qu'en soit l'auteur. */
function latestProposal<T extends { kind: string; proposedTotal: Prisma.Decimal | null }>(negotiations: T[]): T | null {
  return [...negotiations].reverse().find((n) => n.kind === 'COUNTER_OFFER' && n.proposedTotal !== null) ?? null;
}

export const negotiationService = {
  /**
   * Vue complète d'une négociation : l'offre courante, la chronologie, et ce
   * que l'utilisateur a le droit de faire maintenant.
   */
  async get(user: ToumaRequestUser, quoteId: string) {
    await expireStaleQuotes();
    const { quote, isBuyer, isSeller } = await loadNegotiation(user, quoteId);

    const proposal = latestProposal(quote.negotiations);
    const expired = quote.validUntil.getTime() < Date.now() || quote.status === 'EXPIRED';
    const open = !isTerminal(quote.status) && !expired;

    const conversation = await prisma.toumaConversation.findFirst({
      where: { kind: 'QUOTE', quoteId: quote.id, participants: { some: { userId: user.id } } },
      select: { id: true },
    });

    return {
      id: quote.id,
      reference: quote.reference,
      status: quote.status,
      currency: quote.currency,
      expired,
      validUntil: quote.validUntil,
      leadTimeDays: quote.leadTimeDays,
      itemsTotal: quote.itemsTotal.toString(),
      shippingTotal: quote.shippingTotal.toString(),
      total: quote.total.toString(),
      conversationId: conversation?.id ?? null,
      rfq: quote.rfq,
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
      /** Chronologie immuable : chaque événement garde sa date et son auteur. */
      timeline: quote.negotiations.map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        author: n.author,
        side: n.authorId === quote.rfq.buyerId ? 'BUYER' : n.authorId === quote.sellerId ? 'SELLER' : 'ADMIN',
        total: n.proposedTotal?.toString() ?? null,
        itemsTotal: n.proposedItemsTotal?.toString() ?? null,
        shipping: n.proposedShipping?.toString() ?? null,
        leadTimeDays: n.proposedLeadTimeDays,
        items: n.proposedItems ?? null,
        expiresAt: n.expiresAt,
        createdAt: n.createdAt,
      })),
      /** Proposition en attente de réponse (celle de l'autre partie). */
      pendingProposal: proposal
        ? {
            id: proposal.id,
            total: proposal.proposedTotal?.toString() ?? null,
            byMe: proposal.authorId === user.id,
            expiresAt: proposal.expiresAt,
            expired: Boolean(proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()),
          }
        : null,
      permissions: {
        /** L'acheteur transforme l'offre en commande ; le vendeur ne s'auto-commande pas. */
        canAccept: open && isBuyer,
        /** Le vendeur peut entériner la demande de l'acheteur. */
        canApplyProposal: open && isSeller && Boolean(proposal && proposal.authorId !== user.id),
        canCounter: open && (isBuyer || isSeller),
        canReject: open && (isBuyer || isSeller),
      },
    };
  },

  /**
   * Contre-proposition.
   *
   * Côté **vendeur**, elle remplace réellement son offre : lignes, totaux,
   * délai et validité sont réécrits ensemble — c'est le défaut de la V13, où
   * seul le total changeait et où la somme des lignes ne correspondait plus.
   *
   * Côté **acheteur**, elle reste une demande : l'offre du fournisseur n'est
   * pas modifiée tant qu'il ne l'a pas entérinée.
   */
  async counter(
    user: ToumaRequestUser,
    quoteId: string,
    input: { items: OfferLineInput[]; shippingTotal: string; leadTimeDays: number; validityDays?: number; note?: string },
  ) {
    await expireStaleQuotes();
    const { quote, isBuyer, isSeller } = await loadNegotiation(user, quoteId);
    if (!isBuyer && !isSeller) throw forbidden('Seules les parties à la négociation peuvent proposer.');
    if (isTerminal(quote.status)) throw conflict('Cette négociation est close.');
    if (quote.validUntil.getTime() < Date.now()) throw conflict('Cette offre a expiré : demandez au fournisseur de la renouveler.');
    consume(user.id, MESSAGING_RULES.offer);

    // Une ligne proposée doit correspondre à une ligne demandée si elle en cite une.
    const rfqItems = await prisma.toumaRfqItem.findMany({ where: { rfqId: quote.rfqId }, select: { id: true } });
    const known = new Set(rfqItems.map((i) => i.id));
    for (const line of input.items) {
      if (line.rfqItemId && !known.has(line.rfqItemId)) throw badRequest('Une ligne proposée ne correspond à aucune ligne demandée.');
    }

    const computed = computeOffer(input.items, input.shippingTotal, quote.currency);
    const expiresAt = input.validityDays ? new Date(Date.now() + input.validityDays * 24 * 3600 * 1000) : null;

    const result = await prisma.$transaction(async (tx) => {
      const negotiation = await tx.toumaNegotiationMessage.create({
        data: {
          quoteId: quote.id,
          authorId: user.id,
          kind: 'COUNTER_OFFER',
          body: input.note?.trim() || (isSeller ? 'Offre révisée.' : 'Contre-proposition.'),
          proposedTotal: computed.total,
          proposedItemsTotal: computed.itemsTotal,
          proposedShipping: computed.shipping,
          proposedLeadTimeDays: input.leadTimeDays,
          proposedItems: computed.items.map((i) => ({
            rfqItemId: i.rfqItemId,
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice.toString(),
            lineTotal: i.lineTotal.toString(),
          })) as object,
          expiresAt,
        },
      });

      assertQuoteTransition(quote.status, 'COUNTERED');
      if (isSeller) {
        // Le vendeur révise son offre : les lignes suivent le total.
        await tx.toumaQuoteItem.deleteMany({ where: { quoteId: quote.id } });
        await tx.toumaQuoteItem.createMany({
          data: computed.items.map((i) => ({
            quoteId: quote.id,
            rfqItemId: i.rfqItemId,
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
          })),
        });
        await tx.toumaQuote.update({
          where: { id: quote.id },
          data: {
            status: 'COUNTERED',
            itemsTotal: computed.itemsTotal,
            shippingTotal: computed.shipping,
            total: computed.total,
            leadTimeDays: input.leadTimeDays,
            ...(expiresAt ? { validUntil: expiresAt } : {}),
          },
        });
      } else {
        await tx.toumaQuote.update({ where: { id: quote.id }, data: { status: 'COUNTERED' } });
      }
      return negotiation;
    });

    const message = await this.postOfferCard(quote.id, result.id, user.id, isSeller ? 'OFFER' : 'COUNTER_OFFER');

    const recipientId = isBuyer ? quote.sellerId : quote.rfq.buyerId;
    await Promise.all([
      notify({
        userId: recipientId,
        type: 'COUNTER_OFFER_RECEIVED',
        title: isSeller ? 'Offre révisée' : 'Contre-proposition reçue',
        body: `${quote.reference} — ${computed.total.toString()} ${quote.currency}`,
        data: { quoteId: quote.id, rfqId: quote.rfqId, negotiationId: result.id, conversationId: message?.conversationId ?? null },
      }),
      audit({
        actorId: user.id,
        action: isSeller ? 'negotiation.revise' : 'negotiation.counter',
        entity: 'ToumaQuote',
        entityId: quote.id,
        metadata: { total: computed.total.toString(), currency: quote.currency },
      }),
    ]);

    return {
      id: result.id,
      quoteId: quote.id,
      kind: 'COUNTER_OFFER' as const,
      appliedToQuote: isSeller,
      itemsTotal: computed.itemsTotal.toString(),
      shipping: computed.shipping.toString(),
      total: computed.total.toString(),
      currency: quote.currency,
      leadTimeDays: input.leadTimeDays,
      expiresAt,
      createdAt: result.createdAt,
    };
  },

  /**
   * Le vendeur entérine la demande de l'acheteur : la proposition devient son
   * offre. L'acheteur garde la main pour transformer l'offre en commande — on
   * ne crée jamais une commande dans le dos de celui qui paie.
   */
  async applyProposal(user: ToumaRequestUser, quoteId: string, negotiationId?: string) {
    const { quote, isSeller } = await loadNegotiation(user, quoteId);
    if (!isSeller) throw forbidden('Seul le fournisseur peut entériner une contre-proposition.');
    if (isTerminal(quote.status)) throw conflict('Cette négociation est close.');

    const proposal = negotiationId
      ? quote.negotiations.find((n) => n.id === negotiationId) ?? null
      : latestProposal(quote.negotiations);
    if (!proposal || proposal.kind !== 'COUNTER_OFFER') throw notFound('Aucune contre-proposition à entériner.');
    if (proposal.authorId === user.id) throw badRequest('Cette proposition est la vôtre.');
    if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) throw conflict('Cette contre-proposition a expiré.');
    if (!proposal.proposedTotal || !proposal.proposedItems) throw conflict('Cette contre-proposition ne porte aucun montant.');

    const lines = proposal.proposedItems as unknown as Array<{ rfqItemId: string | null; name: string; quantity: number; unit: string; unitPrice: string }>;
    const computed = computeOffer(lines, (proposal.proposedShipping ?? quote.shippingTotal).toString(), quote.currency);

    await prisma.$transaction(async (tx) => {
      await tx.toumaQuoteItem.deleteMany({ where: { quoteId: quote.id } });
      await tx.toumaQuoteItem.createMany({
        data: computed.items.map((i) => ({
          quoteId: quote.id,
          rfqItemId: i.rfqItemId,
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
      });
      await tx.toumaQuote.update({
        where: { id: quote.id },
        data: {
          status: 'COUNTERED',
          itemsTotal: computed.itemsTotal,
          shippingTotal: computed.shipping,
          total: computed.total,
          ...(proposal.proposedLeadTimeDays ? { leadTimeDays: proposal.proposedLeadTimeDays } : {}),
        },
      });
      await tx.toumaNegotiationMessage.create({
        data: {
          quoteId: quote.id,
          authorId: user.id,
          kind: 'MESSAGE',
          body: `Contre-proposition acceptée : offre alignée sur ${computed.total.toString()} ${quote.currency}.`,
        },
      });
    });

    await this.postSystem(quote.id, `Le fournisseur a accepté la contre-proposition : ${computed.total.toString()} ${quote.currency}.`);
    await notify({
      userId: quote.rfq.buyerId,
      type: 'OFFER_RECEIVED',
      title: 'Votre contre-proposition est acceptée',
      body: `${quote.reference} — ${computed.total.toString()} ${quote.currency}. Confirmez pour créer la commande.`,
      data: { quoteId: quote.id, rfqId: quote.rfqId },
    });
    await audit({ actorId: user.id, action: 'negotiation.apply_proposal', entity: 'ToumaQuote', entityId: quote.id, metadata: { total: computed.total.toString() } });

    return { quoteId: quote.id, total: computed.total.toString(), currency: quote.currency, status: 'COUNTERED' as const };
  },

  /** Refus d'une proposition ou de l'offre, selon qui parle. */
  async reject(user: ToumaRequestUser, quoteId: string, reason?: string) {
    const { quote, isBuyer, isSeller } = await loadNegotiation(user, quoteId);
    if (isTerminal(quote.status)) throw conflict('Cette négociation est déjà close.');

    if (isBuyer) {
      assertQuoteTransition(quote.status, 'REJECTED');
      await prisma.$transaction(async (tx) => {
        const updated = await tx.toumaQuote.updateMany({
          where: { id: quote.id, status: { in: ['SUBMITTED', 'COUNTERED'] } },
          data: { status: 'REJECTED' },
        });
        if (updated.count === 0) throw conflict('Cette offre vient d’être tranchée.');
        await tx.toumaNegotiationMessage.create({
          data: { quoteId: quote.id, authorId: user.id, kind: 'REJECT', body: reason?.trim() || 'Offre non retenue.' },
        });
      });
      await this.postSystem(quote.id, 'L’acheteur n’a pas retenu cette offre.');
      await notify({
        userId: quote.sellerId,
        type: 'OFFER_REJECTED',
        title: 'Offre non retenue',
        body: `Votre offre ${quote.reference} n’a pas été retenue.`,
        data: { quoteId: quote.id },
      });
      await audit({ actorId: user.id, action: 'negotiation.reject', entity: 'ToumaQuote', entityId: quote.id });
      return { quoteId: quote.id, status: 'REJECTED' as const };
    }

    if (!isSeller) throw forbidden('Action réservée aux parties de la négociation.');
    // Le vendeur refuse la contre-proposition : l'offre reste vivante.
    await prisma.toumaNegotiationMessage.create({
      data: { quoteId: quote.id, authorId: user.id, kind: 'MESSAGE', body: reason?.trim() || 'Contre-proposition déclinée : l’offre reste celle proposée.' },
    });
    await this.postSystem(quote.id, 'Le fournisseur a décliné la contre-proposition.');
    await notify({
      userId: quote.rfq.buyerId,
      type: 'OFFER_REJECTED',
      title: 'Contre-proposition déclinée',
      body: `${quote.reference} — le fournisseur maintient son offre.`,
      data: { quoteId: quote.id },
    });
    return { quoteId: quote.id, status: quote.status };
  },

  /** Retrait d'une offre par son fournisseur, tant qu'elle n'est pas acceptée. */
  async withdraw(user: ToumaRequestUser, quoteId: string, reason?: string) {
    const { quote, isSeller } = await loadNegotiation(user, quoteId);
    if (!isSeller) throw forbidden('Seul le fournisseur peut retirer son offre.');
    assertQuoteTransition(quote.status, 'WITHDRAWN');

    const updated = await prisma.toumaQuote.updateMany({
      where: { id: quote.id, status: { in: ['SUBMITTED', 'COUNTERED'] } },
      data: { status: 'WITHDRAWN' },
    });
    if (updated.count === 0) throw conflict('Cette offre ne peut plus être retirée.');
    await prisma.toumaNegotiationMessage.create({
      data: { quoteId: quote.id, authorId: user.id, kind: 'MESSAGE', body: reason?.trim() || 'Offre retirée par le fournisseur.' },
    });
    await this.postSystem(quote.id, 'Le fournisseur a retiré son offre.');
    await audit({ actorId: user.id, action: 'negotiation.withdraw', entity: 'ToumaQuote', entityId: quote.id });
    return { quoteId: quote.id, status: 'WITHDRAWN' as const };
  },

  // ── Liens avec la messagerie ──────────────────────────────────────────────
  /** Conversation dédiée à une offre (créée à la première nécessité). */
  async conversationForQuote(quoteId: string) {
    const quote = await prisma.toumaQuote.findUnique({
      where: { id: quoteId },
      select: { id: true, reference: true, rfqId: true, storeId: true, sellerId: true, rfq: { select: { buyerId: true, title: true } } },
    });
    if (!quote) throw notFound('Offre introuvable.');
    const business = await prisma.toumaBusinessProfile.findUnique({ where: { userId: quote.rfq.buyerId }, select: { id: true } });
    return systemMessaging.ensureConversation({
      kind: 'QUOTE',
      subject: `Offre ${quote.reference} — ${quote.rfq.title}`,
      storeId: quote.storeId,
      rfqId: quote.rfqId,
      quoteId: quote.id,
      createdById: quote.sellerId,
      participants: [
        { userId: quote.rfq.buyerId, role: 'BUYER', businessProfileId: business?.id ?? null },
        { userId: quote.sellerId, role: 'SELLER' },
      ],
    });
  },

  /** Publie la carte d'offre dans la conversation de la négociation. */
  async postOfferCard(quoteId: string, negotiationId: string, authorId: string, type: 'OFFER' | 'COUNTER_OFFER' | 'QUOTE') {
    const conversation = await this.conversationForQuote(quoteId);
    const negotiation = await prisma.toumaNegotiationMessage.findUnique({ where: { id: negotiationId } });
    const message = await systemMessaging.post({
      conversationId: conversation.id,
      type,
      authorId,
      body: negotiation?.body ?? 'Proposition commerciale',
      negotiationMessageId: negotiationId,
      metadata: { quoteId },
    });
    await systemMessaging.announce(conversation.id, 'offer.created', { messageId: message.id, quoteId, negotiationId });
    return { conversationId: conversation.id, messageId: message.id };
  },

  /** Message système dans la conversation d'une offre. */
  async postSystem(quoteId: string, body: string) {
    const conversation = await this.conversationForQuote(quoteId);
    const message = await systemMessaging.post({ conversationId: conversation.id, type: 'SYSTEM', body, metadata: { quoteId } });
    await systemMessaging.announce(conversation.id, 'message.created', { messageId: message.id, quoteId });
    return { conversationId: conversation.id, messageId: message.id };
  },
};

