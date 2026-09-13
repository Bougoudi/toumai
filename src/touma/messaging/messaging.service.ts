import { Prisma, type ConversationKind, type MessageType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { consume, MESSAGING_RULES } from '../lib/throttle.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import { signedUrl, storeAttachment } from './attachments.js';
import { presence, publish } from './events.js';
import { needsWarning, SAFETY_NOTICE, scanText } from './risk.js';

/**
 * Messagerie commerciale TOUMA.
 *
 * L'accès repose entièrement sur la **participation** : on ne lit et on
 * n'écrit que dans les fils dont on est participant. Un identifiant deviné ne
 * donne accès à rien, et une conversation d'autrui répond « introuvable »,
 * jamais « interdit » — sinon la réponse elle-même révèle son existence.
 *
 * Une conversation porte toujours son contexte commercial : la boutique, la
 * demande d'achat, l'offre, la commande. C'est ce qui distingue TOUMA d'une
 * application de discussion : le fournisseur sait immédiatement qui le
 * contacte, pour quel produit, quelle quantité et quelle échéance.
 */

/** Durée pendant laquelle un message reste modifiable par son auteur. */
export const EDIT_WINDOW_MS = Number(process.env.TOUMA_MESSAGE_EDIT_WINDOW_MINUTES ?? 15) * 60 * 1000;

/** Taille de page par défaut pour les messages (pagination par curseur). */
const MESSAGE_PAGE = 50;

export interface ParticipantSeed {
  userId: string;
  role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SUPPORT';
  businessProfileId?: string | null;
}

const conversationContext = {
  store: { select: { id: true, name: true, slug: true, countryCode: true, verificationStatus: true } },
  order: { select: { id: true, orderNumber: true, status: true, total: true, currency: true } },
  rfq: { select: { id: true, reference: true, title: true, status: true, currency: true } },
  quote: { select: { id: true, reference: true, status: true, total: true, currency: true, validUntil: true, leadTimeDays: true } },
};

/** Étiquette lisible d'un fil, selon son contexte. */
function conversationTitle(c: {
  subject: string | null;
  store: { name: string } | null;
  rfq: { title: string } | null;
  quote: { reference: string } | null;
  order: { orderNumber: string } | null;
}): string {
  return (
    c.subject ??
    c.store?.name ??
    (c.rfq ? `Appel d'offres ${c.rfq.title}` : null) ??
    (c.quote ? `Offre ${c.quote.reference}` : null) ??
    (c.order ? `Commande ${c.order.orderNumber}` : null) ??
    'Conversation'
  );
}

type PrismaTx = Prisma.TransactionClient;

/**
 * Charge une conversation dont l'utilisateur est participant.
 *
 * Un administrateur peut lire un fil sans y participer — c'est nécessaire pour
 * traiter un signalement — mais l'accès est **tracé**, et il ne peut pas y
 * écrire comme s'il était un participant commercial (voir `sendMessage`).
 */
async function requireParticipant(user: ToumaRequestUser, conversationId: string) {
  const conversation = await prisma.toumaConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: { include: { user: { select: { id: true, name: true } } } },
      ...conversationContext,
    },
  });
  if (!conversation) throw notFound('Conversation introuvable.');

  const participant = conversation.participants.find((p) => p.userId === user.id);
  if (!participant) {
    if (user.role !== 'ADMIN') throw notFound('Conversation introuvable.');
    await audit({
      actorId: user.id,
      action: 'conversation.admin_read',
      entity: 'ToumaConversation',
      entityId: conversation.id,
      metadata: { kind: conversation.kind },
    });
  }
  return { conversation, participant: participant ?? null };
}

/** Deux utilisateurs sont-ils séparés par un blocage (dans un sens ou l'autre) ? */
async function isBlocked(a: string, b: string): Promise<boolean> {
  const block = await prisma.toumaUserBlock.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { id: true },
  });
  return Boolean(block);
}

/** Non-lus par conversation, en une seule requête pour toute la page. */
async function unreadByConversation(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; unread: bigint }>>`
    SELECT m."conversationId" AS "conversationId", COUNT(*) AS unread
    FROM touma_messages m
    JOIN touma_conversation_participants p
      ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
    WHERE m."conversationId" = ANY(${conversationIds})
      AND m."deletedAt" IS NULL
      AND (m."authorId" IS NULL OR m."authorId" <> ${userId})
      AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
    GROUP BY m."conversationId"`;
  return new Map(rows.map((r) => [r.conversationId, Number(r.unread)]));
}

function serializeAttachment(a: { id: string; name: string; mimeType: string; sizeBytes: number; url: string | null; storageKey: string | null }) {
  // Un fichier stocké par TOUMA n'est jamais exposé par son chemin : seule une
  // URL signée à durée courte permet de le lire.
  const link = a.storageKey ? signedUrl(a.id) : { url: a.url ?? '', expiresAt: null };
  return { id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: link.url, expiresAt: link.expiresAt };
}

type MessageRow = Prisma.ToumaMessageGetPayload<{
  include: {
    author: { select: { id: true; name: true } };
    attachments: true;
    replyTo: { select: { id: true; body: true; type: true; deletedAt: true; author: { select: { id: true; name: true } } } };
    negotiation: true;
  };
}>;

function serializeMessage(m: MessageRow, userId: string) {
  const deleted = Boolean(m.deletedAt);
  return {
    id: m.id,
    type: m.type,
    // Un message supprimé laisse sa place dans le fil : l'historique d'une
    // négociation ne se réécrit pas, il s'annote.
    body: deleted ? 'Message supprimé' : m.body,
    deleted,
    metadata: deleted ? {} : (m.metadata as Record<string, unknown>),
    author: m.author ?? null,
    mine: m.authorId === userId,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          author: m.replyTo.author?.name ?? 'TOUMA',
          body: m.replyTo.deletedAt ? 'Message supprimé' : m.replyTo.body.slice(0, 180),
        }
      : null,
    offer: m.negotiation
      ? {
          id: m.negotiation.id,
          kind: m.negotiation.kind,
          total: m.negotiation.proposedTotal?.toString() ?? null,
          itemsTotal: m.negotiation.proposedItemsTotal?.toString() ?? null,
          shipping: m.negotiation.proposedShipping?.toString() ?? null,
          leadTimeDays: m.negotiation.proposedLeadTimeDays,
          items: (m.negotiation.proposedItems as unknown) ?? null,
          expiresAt: m.negotiation.expiresAt,
          expired: Boolean(m.negotiation.expiresAt && m.negotiation.expiresAt.getTime() < Date.now()),
        }
      : null,
    attachments: deleted ? [] : m.attachments.map(serializeAttachment),
    editable: m.authorId === userId && !deleted && m.type === 'TEXT' && Date.now() - m.createdAt.getTime() < EDIT_WINDOW_MS,
    editedAt: m.editedAt,
    createdAt: m.createdAt,
  };
}

const messageInclude = {
  author: { select: { id: true, name: true } },
  attachments: true,
  replyTo: { select: { id: true, body: true, type: true, deletedAt: true, author: { select: { id: true, name: true } } } },
  negotiation: true,
} satisfies Prisma.ToumaMessageInclude;

/**
 * Écritures réservées au serveur : ouverture d'un fil de contexte, message
 * système, carte d'offre. Aucun utilisateur ne peut produire ces messages —
 * « le paiement a été confirmé » ne doit jamais pouvoir être écrit à la main.
 */
export const systemMessaging = {
  /**
   * Retrouve ou crée la conversation d'un contexte donné. Idempotent : deux
   * appels concurrents ne créent pas deux fils (contrainte vérifiée puis
   * relecture en cas de course).
   */
  async ensureConversation(
    input: {
      kind: ConversationKind;
      subject?: string;
      storeId?: string | null;
      orderId?: string | null;
      rfqId?: string | null;
      quoteId?: string | null;
      createdById?: string | null;
      participants: ParticipantSeed[];
    },
    tx: PrismaTx | typeof prisma = prisma,
  ): Promise<{ id: string; created: boolean }> {
    // Le contexte ne suffit pas à identifier un fil : deux acheteurs peuvent
    // discuter avec la même boutique. Les participants font partie de la clé,
    // sans quoi le second acheteur récupérerait le fil du premier.
    const where: Prisma.ToumaConversationWhereInput = {
      kind: input.kind,
      storeId: input.storeId ?? null,
      orderId: input.orderId ?? null,
      rfqId: input.rfqId ?? null,
      quoteId: input.quoteId ?? null,
      AND: input.participants.map((p) => ({ participants: { some: { userId: p.userId } } })),
    };
    const existing = await tx.toumaConversation.findFirst({ where, select: { id: true } });
    if (existing) return { id: existing.id, created: false };

    const conversation = await tx.toumaConversation.create({
      data: {
        kind: input.kind,
        subject: input.subject ?? null,
        storeId: input.storeId ?? null,
        orderId: input.orderId ?? null,
        rfqId: input.rfqId ?? null,
        quoteId: input.quoteId ?? null,
        createdById: input.createdById ?? null,
        participants: {
          create: input.participants.map((p) => ({
            userId: p.userId,
            role: p.role,
            businessProfileId: p.businessProfileId ?? null,
          })),
        },
      },
      select: { id: true },
    });
    return { id: conversation.id, created: true };
  },

  /**
   * Publie un message émis par la plateforme elle-même (sans auteur) ou une
   * carte d'offre rattachée à sa proposition.
   */
  async post(
    input: {
      conversationId: string;
      type: MessageType;
      body: string;
      authorId?: string | null;
      metadata?: Record<string, unknown>;
      negotiationMessageId?: string | null;
    },
    tx: PrismaTx | typeof prisma = prisma,
  ) {
    const message = await tx.toumaMessage.create({
      data: {
        conversationId: input.conversationId,
        authorId: input.authorId ?? null,
        type: input.type,
        body: input.body,
        metadata: (input.metadata ?? {}) as object,
        negotiationMessageId: input.negotiationMessageId ?? null,
      },
      select: { id: true, createdAt: true },
    });
    await tx.toumaConversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: message.createdAt } });
    return message;
  },

  /** Diffuse l'événement temps réel après un message posté par le serveur. */
  async announce(conversationId: string, name: 'message.created' | 'offer.created' | 'offer.accepted' | 'offer.rejected', payload: Record<string, unknown> = {}) {
    const participants = await prisma.toumaConversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    publish({ name, conversationId, userIds: participants.map((p) => p.userId), payload });
  },
};

export const messagingService = {
  /** Liste filtrable et paginée des fils de l'utilisateur. */
  async list(
    user: ToumaRequestUser,
    query: {
      q?: string;
      kind?: ConversationKind;
      status?: 'ACTIVE' | 'ARCHIVED' | 'CLOSED' | 'BLOCKED';
      unread?: boolean;
      rfqId?: string;
      quoteId?: string;
      orderId?: string;
      page: number;
      limit: number;
    },
  ) {
    const where: Prisma.ToumaConversationWhereInput = {
      participants: { some: { userId: user.id, ...(query.status === 'ARCHIVED' ? { archivedAt: { not: null } } : { archivedAt: null }) } },
      ...(query.status && query.status !== 'ARCHIVED' ? { status: query.status } : {}),
      ...(query.rfqId ? { rfqId: query.rfqId } : {}),
      ...(query.quoteId ? { quoteId: query.quoteId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q
        ? {
            OR: [
              { subject: { contains: query.q, mode: 'insensitive' } },
              { store: { name: { contains: query.q, mode: 'insensitive' } } },
              { rfq: { title: { contains: query.q, mode: 'insensitive' } } },
              { quote: { reference: { contains: query.q, mode: 'insensitive' } } },
              { order: { orderNumber: { contains: query.q, mode: 'insensitive' } } },
              { participants: { some: { userId: { not: user.id }, user: { name: { contains: query.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      prisma.toumaConversation.findMany({
        where,
        include: {
          participants: { include: { user: { select: { id: true, name: true } } } },
          ...conversationContext,
          messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, type: true, createdAt: true, authorId: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.toumaConversation.count({ where }),
    ]);

    const unread = await unreadByConversation(user.id, rows.map((r) => r.id));

    const items = rows
      .map((c) => {
        const me = c.participants.find((p) => p.userId === user.id);
        const others = c.participants.filter((p) => p.userId !== user.id);
        const last = c.messages[0];
        return {
          id: c.id,
          kind: c.kind,
          status: c.status,
          title: conversationTitle(c),
          subject: c.subject,
          store: c.store,
          order: c.order,
          rfq: c.rfq,
          quote: c.quote ? { ...c.quote, total: c.quote.total.toString() } : null,
          participants: others.map((p) => ({ id: p.user.id, name: p.user.name, role: p.role })),
          lastMessage: last
            ? { body: last.type === 'TEXT' ? last.body.slice(0, 160) : last.body.slice(0, 160), type: last.type, createdAt: last.createdAt, mine: last.authorId === user.id }
            : null,
          lastMessageAt: c.lastMessageAt,
          muted: Boolean(me?.mutedAt),
          archived: Boolean(me?.archivedAt),
          /** Booléen conservé depuis la V13 (pastille) ; le compteur est nouveau. */
          unread: (unread.get(c.id) ?? 0) > 0,
          unreadCount: unread.get(c.id) ?? 0,
        };
      })
      .filter((c) => (query.unread ? c.unreadCount > 0 : true));

    return { items, page: query.page, limit: query.limit, total, pages: Math.max(1, Math.ceil(total / query.limit)), hasNext: skip + query.limit < total };
  },

  /**
   * Compteurs de non-lus (messages, conversations, notifications) en trois
   * requêtes agrégées — jamais un parcours de tous les fils.
   */
  async unreadSummary(userId: string) {
    const [rows, notifications] = await Promise.all([
      prisma.$queryRaw<Array<{ conversations: bigint; messages: bigint }>>`
        SELECT COUNT(DISTINCT m."conversationId") AS conversations, COUNT(*) AS messages
        FROM touma_messages m
        JOIN touma_conversation_participants p
          ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
        WHERE m."deletedAt" IS NULL
          AND (m."authorId" IS NULL OR m."authorId" <> ${userId})
          AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")`,
      prisma.toumaNotification.count({ where: { userId, readAt: null } }),
    ]);
    const row = rows[0] ?? { conversations: 0n, messages: 0n };
    return {
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      notifications,
      /** Compatibilité V13 : la pastille d'en-tête lisait `count`. */
      count: Number(row.conversations),
    };
  },

  /** En-tête d'un fil : contexte commercial, participants, droits, derniers messages. */
  async get(user: ToumaRequestUser, conversationId: string) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    // La dernière page de messages accompagne l'en-tête : un fil s'ouvre en un
    // seul aller-retour, et le contrat de la V13 (`messages`) reste honoré.
    const page = await this.messages(user, conversationId);
    return {
      id: conversation.id,
      kind: conversation.kind,
      status: conversation.status,
      title: conversationTitle(conversation),
      subject: conversation.subject,
      store: conversation.store,
      order: conversation.order ? { ...conversation.order, total: conversation.order.total.toString() } : null,
      rfq: conversation.rfq,
      quote: conversation.quote ? { ...conversation.quote, total: conversation.quote.total.toString() } : null,
      myRole: participant?.role ?? 'ADMIN',
      canWrite: Boolean(participant) && conversation.status === 'ACTIVE',
      muted: Boolean(participant?.mutedAt),
      archived: Boolean(participant?.archivedAt),
      participants: conversation.participants
        .filter((p) => p.userId !== user.id)
        .map((p) => ({ id: p.user.id, name: p.user.name, role: p.role, presence: presence(p.userId), lastSeenAt: null })),
      createdAt: conversation.createdAt,
      messages: page.items,
      hasMore: page.hasMore,
      olderCursor: page.olderCursor,
    };
  },

  /**
   * Messages d'un fil, par curseur. Par défaut les plus récents ; `before`
   * remonte dans l'historique. On ne charge jamais un fil entier.
   */
  async messages(user: ToumaRequestUser, conversationId: string, options: { before?: string; limit?: number } = {}) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    const limit = Math.min(100, Math.max(1, options.limit ?? MESSAGE_PAGE));

    let cursorDate: Date | undefined;
    if (options.before) {
      const anchor = await prisma.toumaMessage.findFirst({
        where: { id: options.before, conversationId: conversation.id },
        select: { createdAt: true },
      });
      if (!anchor) throw notFound('Message introuvable.');
      cursorDate = anchor.createdAt;
    }

    const rows = await prisma.toumaMessage.findMany({
      where: { conversationId: conversation.id, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();

    // La lecture marque le fil comme lu jusqu'au dernier message affiché.
    if (participant && !options.before && page.length > 0) {
      await prisma.toumaConversationParticipant.update({
        where: { id: participant.id },
        data: { lastReadAt: new Date() },
      });
      publish({
        name: 'message.read',
        conversationId: conversation.id,
        userIds: conversation.participants.map((p) => p.userId),
        payload: { userId: user.id, readAt: new Date().toISOString() },
      });
    }

    return {
      items: page.map((m) => serializeMessage(m, user.id)),
      hasMore,
      /** Curseur à repasser en `before` pour remonter l'historique. */
      olderCursor: hasMore ? page[0]?.id ?? null : null,
    };
  },

  /** Ouvre (ou retrouve) la conversation directe entre un acheteur et une boutique. */
  async openWithStore(user: ToumaRequestUser, input: { storeId: string; orderId?: string; rfqId?: string; subject?: string; message?: string }) {
    const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId } });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');
    if (store.ownerId === user.id) throw badRequest('Vous ne pouvez pas ouvrir une conversation avec votre propre boutique.');
    if (await isBlocked(user.id, store.ownerId)) throw forbidden('Cette conversation n’est pas disponible.');

    if (input.orderId) {
      const order = await prisma.toumaOrder.findUnique({ where: { id: input.orderId } });
      if (!order || (order.buyerId !== user.id && store.ownerId !== user.id)) throw notFound('Commande introuvable.');
    }

    // Un appel d'offres a sa propre conversation par fournisseur : on ne
    // mélange pas les négociations concurrentes dans un fil générique.
    if (input.rfqId) {
      const rfq = await prisma.toumaRfq.findUnique({ where: { id: input.rfqId }, select: { id: true, buyerId: true, title: true } });
      if (!rfq || rfq.buyerId !== user.id) throw notFound('Appel d’offres introuvable.');
      const business = await prisma.toumaBusinessProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      const result = await systemMessaging.ensureConversation({
        kind: 'RFQ',
        subject: `Appel d'offres — ${rfq.title}`,
        storeId: store.id,
        rfqId: rfq.id,
        createdById: user.id,
        participants: [
          { userId: user.id, role: 'BUYER', businessProfileId: business?.id ?? null },
          { userId: store.ownerId, role: 'SELLER' },
        ],
      });
      if (result.created) consume(user.id, MESSAGING_RULES.conversation);
      if (input.message) await this.sendMessage(user, result.id, { body: input.message });
      return result;
    }

    const existing = await prisma.toumaConversation.findFirst({
      where: {
        kind: input.orderId ? 'ORDER' : 'BUYER_SELLER',
        storeId: store.id,
        orderId: input.orderId ?? null,
        participants: { some: { userId: user.id } },
      },
      select: { id: true },
    });
    if (existing) {
      if (input.message) await this.sendMessage(user, existing.id, { body: input.message });
      return { id: existing.id, created: false as const };
    }

    consume(user.id, MESSAGING_RULES.conversation);
    const business = await prisma.toumaBusinessProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    const created = await systemMessaging.ensureConversation({
      kind: input.orderId ? 'ORDER' : 'BUYER_SELLER',
      subject: input.subject ?? `Échange avec ${store.name}`,
      storeId: store.id,
      orderId: input.orderId ?? null,
      createdById: user.id,
      participants: [
        { userId: user.id, role: 'BUYER', businessProfileId: business?.id ?? null },
        { userId: store.ownerId, role: 'SELLER' },
      ],
    });
    await audit({ actorId: user.id, action: 'conversation.create', entity: 'ToumaConversation', entityId: created.id, metadata: { storeId: store.id } });
    if (input.message) await this.sendMessage(user, created.id, { body: input.message });
    return { id: created.id, created: created.created };
  },

  /** Publie un message dans un fil dont on est participant. */
  async sendMessage(user: ToumaRequestUser, conversationId: string, input: { body: string; replyToId?: string }) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    if (!participant) throw forbidden('Rejoignez la conversation avant d’y écrire.');
    if (conversation.status !== 'ACTIVE') throw conflict('Cette conversation est close : elle ne reçoit plus de message.');

    const others = conversation.participants.filter((p) => p.userId !== user.id);
    for (const other of others) {
      if (await isBlocked(user.id, other.userId)) throw forbidden('Cette conversation n’est plus disponible.');
    }
    consume(user.id, MESSAGING_RULES.message);

    if (input.replyToId) {
      const target = await prisma.toumaMessage.findFirst({ where: { id: input.replyToId, conversationId: conversation.id }, select: { id: true } });
      if (!target) throw badRequest('Le message cité n’appartient pas à cette conversation.');
    }

    // Analyse de risque : elle signale, elle ne supprime jamais.
    const signals = scanText(input.body);
    const repeated = await this.isRepeatedContent(conversation.id, user.id, input.body);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaMessage.create({
        data: {
          conversationId: conversation.id,
          authorId: user.id,
          type: 'TEXT',
          body: input.body,
          replyToId: input.replyToId ?? null,
        },
        include: messageInclude,
      });
      await tx.toumaConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: created.createdAt } });
      await tx.toumaConversationParticipant.update({ where: { id: participant.id }, data: { lastReadAt: created.createdAt } });

      for (const signal of signals) {
        await tx.toumaRiskFlag.create({
          data: { conversationId: conversation.id, messageId: created.id, category: signal.category as never, score: signal.score, excerpt: signal.excerpt },
        });
      }
      if (repeated) {
        await tx.toumaRiskFlag.create({
          data: { conversationId: conversation.id, messageId: created.id, category: 'REPEATED_CONTENT', score: 30, excerpt: input.body.slice(0, 120) },
        });
      }
      return created;
    });

    // Un paiement hors plateforme mérite un rappel visible, adressé aux deux
    // parties : celle qui propose comme celle qui pourrait accepter.
    if (needsWarning(signals)) {
      await systemMessaging.post({ conversationId: conversation.id, type: 'SYSTEM', body: SAFETY_NOTICE });
    }

    await Promise.all([
      ...others
        .filter((p) => !p.mutedAt)
        .map((p) =>
          notify({
            userId: p.userId,
            type: input.replyToId ? 'MESSAGE_REPLY' : 'MESSAGE_RECEIVED',
            title: `Nouveau message — ${conversationTitle(conversation)}`,
            body: input.body.slice(0, 140),
            data: { conversationId: conversation.id, messageId: message.id },
          }),
        ),
      audit({ actorId: user.id, action: 'message.send', entity: 'ToumaMessage', entityId: message.id, metadata: { conversationId: conversation.id } }),
    ]);

    publish({
      name: 'message.created',
      conversationId: conversation.id,
      userIds: conversation.participants.map((p) => p.userId),
      payload: { messageId: message.id, authorId: user.id, preview: input.body.slice(0, 140) },
    });

    return serializeMessage(message, user.id);
  },

  /** Conversation d'un message, une fois la participation vérifiée. */
  async conversationOfMessage(user: ToumaRequestUser, messageId: string): Promise<string> {
    const message = await prisma.toumaMessage.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    if (!message) throw notFound('Message introuvable.');
    await requireParticipant(user, message.conversationId);
    return message.conversationId;
  },

  /** Trois messages identiques d'affilée dans le même fil : signal d'abus. */
  async isRepeatedContent(conversationId: string, authorId: string, body: string): Promise<boolean> {
    const recent = await prisma.toumaMessage.findMany({
      where: { conversationId, authorId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { body: true },
    });
    return recent.length === 2 && recent.every((m) => m.body.trim() === body.trim());
  },

  /** Modification par l'auteur, dans une fenêtre courte. Ensuite, immuable. */
  async editMessage(user: ToumaRequestUser, messageId: string, body: string) {
    const message = await prisma.toumaMessage.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!message) throw notFound('Message introuvable.');
    await requireParticipant(user, message.conversationId);

    if (message.authorId !== user.id) throw forbidden('Seul l’auteur peut modifier son message.');
    if (message.deletedAt) throw conflict('Ce message a été supprimé.');
    // Un message système ou une offre ne se réécrit pas : ce sont des faits.
    if (message.type !== 'TEXT') throw conflict('Ce type de message ne peut pas être modifié.');
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw conflict(`Un message n’est modifiable que pendant ${Math.round(EDIT_WINDOW_MS / 60000)} minutes.`);
    }

    const updated = await prisma.toumaMessage.update({ where: { id: message.id }, data: { body, editedAt: new Date() }, include: messageInclude });
    await audit({ actorId: user.id, action: 'message.edit', entity: 'ToumaMessage', entityId: message.id });
    publish({
      name: 'message.updated',
      conversationId: message.conversationId,
      userIds: (await prisma.toumaConversationParticipant.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })).map((p) => p.userId),
      payload: { messageId: message.id },
    });
    return serializeMessage(updated, user.id);
  },

  /**
   * Suppression douce. Le contenu disparaît de l'affichage, la trace reste :
   * une offre, une contre-offre ou un accord ne s'efface pas d'un fil.
   */
  async deleteMessage(user: ToumaRequestUser, messageId: string) {
    const message = await prisma.toumaMessage.findUnique({ where: { id: messageId } });
    if (!message) throw notFound('Message introuvable.');
    await requireParticipant(user, message.conversationId);

    // L'immuabilité prime sur la qualité d'auteur : une offre, une
    // contre-offre ou un fait système ne s'effacent pour personne.
    if (message.type !== 'TEXT' && message.type !== 'ATTACHMENT') {
      throw conflict('Les messages financiers et système sont conservés : ils font foi en cas de litige.');
    }
    const isAuthor = message.authorId === user.id;
    if (!isAuthor && user.role !== 'ADMIN') throw forbidden('Seul l’auteur peut supprimer son message.');
    if (message.deletedAt) return { id: message.id, deleted: true };

    await prisma.toumaMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } });
    await audit({
      actorId: user.id,
      action: isAuthor ? 'message.delete' : 'message.admin_delete',
      entity: 'ToumaMessage',
      entityId: message.id,
      metadata: { conversationId: message.conversationId },
    });
    publish({
      name: 'message.deleted',
      conversationId: message.conversationId,
      userIds: (await prisma.toumaConversationParticipant.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } })).map((p) => p.userId),
      payload: { messageId: message.id },
    });
    return { id: message.id, deleted: true };
  },

  /** Marque le fil comme lu jusqu'à maintenant. */
  async markRead(user: ToumaRequestUser, conversationId: string) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    if (!participant) throw forbidden('Vous ne participez pas à cette conversation.');
    const readAt = new Date();
    await prisma.toumaConversationParticipant.update({ where: { id: participant.id }, data: { lastReadAt: readAt } });
    publish({
      name: 'message.read',
      conversationId: conversation.id,
      userIds: conversation.participants.map((p) => p.userId),
      payload: { userId: user.id, readAt: readAt.toISOString() },
    });
    return { conversationId: conversation.id, readAt };
  },

  /** Range, sort ou coupe les notifications d'un fil, pour soi uniquement. */
  async updateParticipation(user: ToumaRequestUser, conversationId: string, input: { archived?: boolean; muted?: boolean }) {
    const { participant } = await requireParticipant(user, conversationId);
    if (!participant) throw forbidden('Vous ne participez pas à cette conversation.');
    const updated = await prisma.toumaConversationParticipant.update({
      where: { id: participant.id },
      data: {
        ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
        ...(input.muted === undefined ? {} : { mutedAt: input.muted ? new Date() : null }),
      },
    });
    return { archived: Boolean(updated.archivedAt), muted: Boolean(updated.mutedAt) };
  },

  /**
   * Recherche plein texte limitée aux conversations de l'utilisateur. Aucun
   * message d'un fil auquel il ne participe pas ne peut remonter.
   */
  async search(user: ToumaRequestUser, q: string, limit = 30) {
    const term = q.trim().replace(/\s+/g, ' ');
    if (term.length < 2) return { items: [] };

    const rows = await prisma.toumaMessage.findMany({
      where: {
        deletedAt: null,
        body: { contains: term, mode: 'insensitive' },
        conversation: { participants: { some: { userId: user.id } } },
      },
      include: {
        author: { select: { id: true, name: true } },
        conversation: { include: conversationContext },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, limit),
    });

    return {
      items: rows.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        conversationTitle: conversationTitle(m.conversation),
        kind: m.conversation.kind,
        author: m.author?.name ?? 'TOUMA',
        excerpt: m.body.slice(0, 200),
        createdAt: m.createdAt,
      })),
    };
  },

  // ── Pièces jointes ────────────────────────────────────────────────────────
  /**
   * Reçoit un fichier et le publie dans le fil. Le type et la taille viennent
   * du **contenu**, jamais des en-têtes envoyés par le navigateur.
   */
  async attach(user: ToumaRequestUser, conversationId: string, content: Buffer, fileName: string, caption?: string) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    if (!participant) throw forbidden('Rejoignez la conversation avant d’y écrire.');
    if (conversation.status !== 'ACTIVE') throw conflict('Cette conversation est close.');
    consume(user.id, MESSAGING_RULES.upload);

    const stored = await storeAttachment(content, fileName);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaMessage.create({
        data: {
          conversationId: conversation.id,
          authorId: user.id,
          type: 'ATTACHMENT',
          body: caption?.trim() || stored.name,
          attachments: {
            create: {
              storageKey: stored.storageKey,
              name: stored.name,
              mimeType: stored.mimeType,
              sizeBytes: stored.sizeBytes,
              checksum: stored.checksum,
            },
          },
        },
        include: messageInclude,
      });
      await tx.toumaConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: created.createdAt } });
      return created;
    });

    await Promise.all([
      ...conversation.participants
        .filter((p) => p.userId !== user.id && !p.mutedAt)
        .map((p) =>
          notify({
            userId: p.userId,
            type: 'ATTACHMENT_RECEIVED',
            title: 'Pièce jointe reçue',
            body: `${stored.name} — ${conversationTitle(conversation)}`,
            data: { conversationId: conversation.id, messageId: message.id },
          }),
        ),
      audit({
        actorId: user.id,
        action: 'attachment.upload',
        entity: 'ToumaMessage',
        entityId: message.id,
        // Le nom du fichier suffit : le contenu n'a rien à faire dans l'audit.
        metadata: { conversationId: conversation.id, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes },
      }),
    ]);

    publish({
      name: 'message.created',
      conversationId: conversation.id,
      userIds: conversation.participants.map((p) => p.userId),
      payload: { messageId: message.id, authorId: user.id, preview: stored.name },
    });
    return serializeMessage(message, user.id);
  },

  /**
   * Autorise le téléchargement : le fichier n'est servi qu'aux participants du
   * fil auquel il appartient.
   */
  async attachmentForUser(user: ToumaRequestUser, attachmentId: string) {
    const attachment = await prisma.toumaMessageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { conversationId: true, deletedAt: true } } },
    });
    if (!attachment || attachment.message.deletedAt) throw notFound('Pièce jointe introuvable.');
    await requireParticipant(user, attachment.message.conversationId);
    return attachment;
  },

  /** Pièce jointe accessible par URL signée (aucune session nécessaire). */
  async attachmentBySignature(attachmentId: string) {
    const attachment = await prisma.toumaMessageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { select: { deletedAt: true } } },
    });
    if (!attachment || attachment.message.deletedAt) throw notFound('Pièce jointe introuvable.');
    return attachment;
  },
};
