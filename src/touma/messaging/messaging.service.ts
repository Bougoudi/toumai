import { prisma } from '../../db/prisma.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Messagerie TOUMA : acheteur ↔ vendeur, éventuellement rattachée à une
 * commande ou à un appel d'offres.
 *
 * L'accès repose entièrement sur la **participation** : on ne lit et on
 * n'écrit que dans les fils dont on est participant. Aucun identifiant de
 * conversation deviné ne donne accès à quoi que ce soit.
 */

/** Types de pièces jointes acceptés et taille maximale (5 Mo). */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

export interface AttachmentInput {
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

function validateAttachments(attachments: AttachmentInput[]): void {
  if (attachments.length > MAX_ATTACHMENTS) throw badRequest(`Cinq pièces jointes au maximum par message.`);
  for (const a of attachments) {
    if (!ALLOWED_MIME.has(a.mimeType)) {
      throw badRequest(`Type de fichier non autorisé : ${a.mimeType}. Formats acceptés : JPEG, PNG, WebP, PDF.`);
    }
    if (a.sizeBytes > MAX_ATTACHMENT_BYTES) throw badRequest('Chaque pièce jointe doit peser moins de 5 Mo.');
  }
}

/** Charge une conversation dont l'utilisateur est participant (sinon : introuvable). */
async function requireParticipant(user: ToumaRequestUser, conversationId: string) {
  const conversation = await prisma.toumaConversation.findUnique({
    where: { id: conversationId },
    include: { participants: true, store: { select: { id: true, name: true, slug: true } } },
  });
  if (!conversation) throw notFound('Conversation introuvable.');
  const participant = conversation.participants.find((p) => p.userId === user.id);
  if (!participant && user.role !== 'ADMIN') throw notFound('Conversation introuvable.');
  return { conversation, participant };
}

export const messagingService = {
  /** Fils de l'utilisateur, du plus récent au plus ancien, avec le non-lu. */
  async list(user: ToumaRequestUser) {
    const conversations = await prisma.toumaConversation.findMany({
      where: { participants: { some: { userId: user.id } } },
      include: {
        participants: { include: { user: { select: { id: true, name: true } } } },
        store: { select: { id: true, name: true, slug: true } },
        order: { select: { id: true, orderNumber: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });

    return conversations.map((c) => {
      const me = c.participants.find((p) => p.userId === user.id);
      const others = c.participants.filter((p) => p.userId !== user.id).map((p) => p.user.name);
      const last = c.messages[0];
      return {
        id: c.id,
        kind: c.kind,
        subject: c.subject,
        store: c.store,
        order: c.order,
        participants: others,
        lastMessage: last ? { body: last.body.slice(0, 160), createdAt: last.createdAt, authorId: last.authorId } : null,
        lastMessageAt: c.lastMessageAt,
        unread: Boolean(last && (!me?.lastReadAt || me.lastReadAt < last.createdAt) && last.authorId !== user.id),
      };
    });
  },

  /** Nombre de fils comportant des messages non lus (pastille de l'en-tête). */
  async unreadCount(userId: string) {
    const participations = await prisma.toumaConversationParticipant.findMany({
      where: { userId },
      include: { conversation: { include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    });
    return participations.filter((p) => {
      const last = p.conversation.messages[0];
      return Boolean(last && last.authorId !== userId && (!p.lastReadAt || p.lastReadAt < last.createdAt));
    }).length;
  },

  /** Contenu d'un fil ; la lecture met à jour le repère de non-lu. */
  async get(user: ToumaRequestUser, conversationId: string) {
    const { conversation, participant } = await requireParticipant(user, conversationId);
    const messages = await prisma.toumaMessage.findMany({
      where: { conversationId: conversation.id },
      include: { author: { select: { id: true, name: true } }, attachments: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    if (participant) {
      await prisma.toumaConversationParticipant.update({ where: { id: participant.id }, data: { lastReadAt: new Date() } });
    }
    return {
      id: conversation.id,
      kind: conversation.kind,
      subject: conversation.subject,
      store: conversation.store,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        author: m.author,
        mine: m.authorId === user.id,
        attachments: m.attachments.map((a) => ({ id: a.id, url: a.url, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
        createdAt: m.createdAt,
      })),
    };
  },

  /**
   * Ouvre (ou retrouve) la conversation entre l'acheteur et une boutique.
   * Un vendeur ne peut pas s'écrire à lui-même.
   */
  async openWithStore(user: ToumaRequestUser, input: { storeId: string; orderId?: string; subject?: string }) {
    const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId } });
    if (!store || store.status !== 'ACTIVE') throw notFound('Boutique introuvable.');
    if (store.ownerId === user.id) throw badRequest('Vous ne pouvez pas ouvrir une conversation avec votre propre boutique.');

    if (input.orderId) {
      const order = await prisma.toumaOrder.findUnique({ where: { id: input.orderId } });
      if (!order || (order.buyerId !== user.id && store.ownerId !== user.id)) throw notFound('Commande introuvable.');
    }

    const existing = await prisma.toumaConversation.findFirst({
      where: {
        kind: 'BUYER_SELLER',
        storeId: store.id,
        orderId: input.orderId ?? null,
        participants: { some: { userId: user.id } },
      },
    });
    if (existing) return { id: existing.id, created: false as const };

    const conversation = await prisma.toumaConversation.create({
      data: {
        kind: 'BUYER_SELLER',
        subject: input.subject ?? `Échange avec ${store.name}`,
        storeId: store.id,
        orderId: input.orderId ?? null,
        participants: {
          create: [
            { userId: user.id, role: 'BUYER' },
            { userId: store.ownerId, role: 'SELLER' },
          ],
        },
      },
    });
    return { id: conversation.id, created: true as const };
  },

  /** Publie un message dans un fil dont on est participant. */
  async sendMessage(user: ToumaRequestUser, conversationId: string, body: string, attachments: AttachmentInput[] = []) {
    const { conversation } = await requireParticipant(user, conversationId);
    if (user.role === 'ADMIN' && !conversation.participants.some((p) => p.userId === user.id)) {
      throw forbidden('Rejoignez la conversation avant d’y écrire.');
    }
    validateAttachments(attachments);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaMessage.create({
        data: {
          conversationId: conversation.id,
          authorId: user.id,
          body,
          attachments: { create: attachments },
        },
        include: { author: { select: { id: true, name: true } }, attachments: true },
      });
      await tx.toumaConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      await tx.toumaConversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: user.id },
        data: { lastReadAt: new Date() },
      });
      return created;
    });

    // Les autres participants sont prévenus.
    await Promise.all(
      conversation.participants
        .filter((p) => p.userId !== user.id)
        .map((p) =>
          notify({
            userId: p.userId,
            type: 'ORDER_STATUS_CHANGED',
            title: 'Nouveau message',
            body: body.slice(0, 140),
            data: { conversationId: conversation.id },
          }),
        ),
    );

    return {
      id: message.id,
      body: message.body,
      author: message.author,
      mine: true,
      attachments: message.attachments,
      createdAt: message.createdAt,
    };
  },
};
