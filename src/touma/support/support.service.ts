import { randomBytes } from 'node:crypto';
import { Prisma, type TicketCategory } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { paginated, type PageParams } from '../lib/pagination.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';
import type { CreateTicketInput, ListTicketsQuery, ReplyInput, UpdateTicketInput } from './support.schema.js';

/**
 * ASSISTANCE TOUMA.
 *
 * Un ticket appartient à celui qui l'ouvre ; seule l'administration voit la
 * file complète. Les notes internes ne sortent jamais côté demandeur : le
 * filtrage est fait à la lecture, pas dans l'interface.
 */

/** Priorité initiale déduite de la nature du problème, jamais du client. */
const PRIORITY_BY_CATEGORY: Record<TicketCategory, 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'> = {
  PAYMENT: 'HIGH',
  ORDER: 'NORMAL',
  DELIVERY: 'NORMAL',
  RETURN: 'NORMAL',
  ACCOUNT: 'NORMAL',
  STORE: 'NORMAL',
  VERIFICATION: 'LOW',
  OTHER: 'LOW',
};

function reference(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  // Cinq octets, comme au checkout : trois ne donnaient que 16,7 millions de
  // valeurs par jour, et la collision se manifeste par une erreur serveur chez
  // celui qui a perdu au tirage.
  return `AS-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

const ticketInclude = {
  requester: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true } },
  order: { select: { id: true, orderNumber: true, status: true } },
  store: { select: { id: true, name: true, slug: true } },
  messages: { include: { author: { select: { id: true, name: true, toumaRole: true } } }, orderBy: { createdAt: 'asc' as const } },
};

type TicketRow = Prisma.ToumaSupportTicketGetPayload<{ include: typeof ticketInclude }>;

function serialize(ticket: TicketRow, viewer: ToumaRequestUser) {
  const isStaff = viewer.role === 'ADMIN';
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    requester: isStaff ? ticket.requester : { id: ticket.requester.id, name: ticket.requester.name },
    assignedTo: ticket.assignedTo,
    order: ticket.order,
    store: ticket.store,
    createdAt: ticket.createdAt,
    lastReplyAt: ticket.lastReplyAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    messages: ticket.messages
      // Les notes internes restent internes.
      .filter((m) => isStaff || !m.internal)
      .map((m) => ({
        id: m.id,
        body: m.body,
        internal: m.internal,
        attachments: m.attachments,
        createdAt: m.createdAt,
        author: { id: m.author.id, name: m.author.name, role: m.author.toumaRole },
        fromSupport: m.author.toumaRole === 'ADMIN',
      })),
  };
}

async function loadForActor(user: ToumaRequestUser, id: string): Promise<TicketRow> {
  const ticket = await prisma.toumaSupportTicket.findFirst({
    where: { OR: [{ id }, { reference: id }] },
    include: ticketInclude,
  });
  if (!ticket) throw notFound('Ticket introuvable.');
  if (ticket.requesterId !== user.id && user.role !== 'ADMIN') throw notFound('Ticket introuvable.');
  return ticket;
}

export const supportService = {
  /** Ouverture d'un ticket. Le contexte (commande, boutique) est vérifié. */
  async create(user: ToumaRequestUser, input: CreateTicketInput) {
    if (input.orderId) {
      const order = await prisma.toumaOrder.findUnique({
        where: { id: input.orderId },
        select: { buyerId: true, store: { select: { ownerId: true } } },
      });
      // Rattacher une commande d'autrui révélerait son existence : on refuse en amont.
      if (!order || (order.buyerId !== user.id && order.store.ownerId !== user.id && user.role !== 'ADMIN')) {
        throw badRequest('Cette commande ne vous concerne pas.');
      }
    }
    if (input.storeId) {
      const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId }, select: { id: true } });
      if (!store) throw badRequest('Boutique introuvable.');
    }

    const ticket = await prisma.toumaSupportTicket.create({
      data: {
        reference: reference(),
        requesterId: user.id,
        subject: input.subject,
        category: input.category,
        priority: PRIORITY_BY_CATEGORY[input.category],
        orderId: input.orderId ?? null,
        storeId: input.storeId ?? null,
        messages: {
          create: { authorId: user.id, body: input.message, attachments: input.attachments as object },
        },
      },
      include: ticketInclude,
    });

    await audit({ actorId: user.id, action: 'support.ticket.create', entity: 'ToumaSupportTicket', entityId: ticket.id, metadata: { category: input.category } });
    return serialize(ticket, user);
  },

  async list(user: ToumaRequestUser, query: ListTicketsQuery) {
    if (query.scope === 'all' && user.role !== 'ADMIN') throw forbidden('File d’assistance réservée à l’administration.');
    const page: PageParams = { page: query.page, limit: query.limit, skip: (query.page - 1) * query.limit };
    const where: Prisma.ToumaSupportTicketWhereInput = {
      ...(query.scope === 'all' ? {} : { requesterId: user.id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.toumaSupportTicket.findMany({
        where,
        include: { requester: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } }, _count: { select: { messages: true } } },
        orderBy: [{ lastReplyAt: 'desc' }],
        skip: page.skip,
        take: page.limit,
      }),
      prisma.toumaSupportTicket.count({ where }),
    ]);
    return paginated(
      rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        requester: t.requester,
        assignedTo: t.assignedTo,
        messageCount: t._count.messages,
        createdAt: t.createdAt,
        lastReplyAt: t.lastReplyAt,
      })),
      total,
      page,
    );
  },

  async get(user: ToumaRequestUser, id: string) {
    return serialize(await loadForActor(user, id), user);
  },

  /** Réponse au fil. Une note interne est réservée à l'administration. */
  async reply(user: ToumaRequestUser, id: string, input: ReplyInput) {
    const ticket = await loadForActor(user, id);
    if (ticket.status === 'CLOSED') throw conflict('Ce ticket est clos : ouvrez-en un nouveau.');
    if (input.internal && user.role !== 'ADMIN') throw forbidden('Les notes internes sont réservées à l’administration.');

    const isStaff = user.role === 'ADMIN';
    const updated = await prisma.$transaction(async (tx) => {
      await tx.toumaSupportMessage.create({
        data: { ticketId: ticket.id, authorId: user.id, body: input.body, internal: input.internal, attachments: input.attachments as object },
      });
      return tx.toumaSupportTicket.update({
        where: { id: ticket.id },
        data: {
          lastReplyAt: new Date(),
          // Une note interne ne change pas l'état perçu par le demandeur.
          status: input.internal
            ? ticket.status
            : isStaff
              ? 'PENDING_USER'
              : ticket.status === 'RESOLVED'
                ? 'OPEN'
                : 'IN_PROGRESS',
        },
        include: ticketInclude,
      });
    });

    if (!input.internal) {
      const recipient = isStaff ? ticket.requesterId : ticket.assignedToId;
      if (recipient) {
        await notify({
          userId: recipient,
          type: 'ORDER_STATUS_CHANGED',
          title: `Ticket ${ticket.reference}`,
          body: 'Nouvelle réponse sur votre demande d’assistance.',
          data: { ticketId: ticket.id },
        });
      }
    }
    return serialize(updated, user);
  },

  /** Statut, priorité et affectation : administration uniquement. */
  async update(user: ToumaRequestUser, id: string, input: UpdateTicketInput) {
    if (user.role !== 'ADMIN') throw forbidden('Action réservée à l’administration.');
    const ticket = await loadForActor(user, id);
    if (input.assignedToId) {
      const assignee = await prisma.user.findUnique({ where: { id: input.assignedToId }, select: { toumaRole: true } });
      if (!assignee || assignee.toumaRole !== 'ADMIN') throw badRequest('Un ticket ne peut être affecté qu’à un membre de l’équipe.');
    }
    const updated = await prisma.toumaSupportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
        ...(input.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
        ...(input.status === 'CLOSED' ? { closedAt: new Date() } : {}),
      },
      include: ticketInclude,
    });
    await audit({ actorId: user.id, action: 'support.ticket.update', entity: 'ToumaSupportTicket', entityId: ticket.id, metadata: { ...input } });
    if (input.status && input.status !== ticket.status) {
      await notify({
        userId: ticket.requesterId,
        type: 'ORDER_STATUS_CHANGED',
        title: `Ticket ${ticket.reference}`,
        body: `Votre demande est maintenant : ${input.status}.`,
        data: { ticketId: ticket.id, status: input.status },
      });
    }
    return serialize(updated, user);
  },

  /** Le demandeur clôt lui-même son ticket quand il a sa réponse. */
  async close(user: ToumaRequestUser, id: string) {
    const ticket = await loadForActor(user, id);
    if (ticket.status === 'CLOSED') return serialize(ticket, user);
    const updated = await prisma.toumaSupportTicket.update({
      where: { id: ticket.id },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: ticketInclude,
    });
    return serialize(updated, user);
  },
};
