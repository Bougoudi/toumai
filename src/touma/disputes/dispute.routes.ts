import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { audit, auditRequest } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';

/**
 * Litiges Touma. Acheteur et vendeur échangent messages et preuves ; seule
 * l'administration tranche, et sa décision est systématiquement auditée.
 */
export const disputeRouter = Router();

const openSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.enum(['NOT_RECEIVED', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'OTHER']),
  details: z.string().trim().max(2000).optional(),
  evidence: z.array(z.object({ kind: z.string().trim().max(60), url: z.string().trim().url().max(500), note: z.string().trim().max(300).optional() })).max(10).default([]),
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000), internal: z.boolean().default(false) });

const resolveSchema = z.object({
  decision: z.enum(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED']),
  resolution: z.string().trim().max(2000),
  refundAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
});

disputeRouter.use(authenticate);

/** Accès : acheteur, vendeur concerné ou administration. */
async function loadDispute(id: string, user: { id: string; role: string }) {
  const dispute = await prisma.toumaDispute.findUnique({
    where: { id },
    include: {
      order: { include: { store: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
      evidence: true,
    },
  });
  if (!dispute) throw notFound('Litige introuvable.');
  const allowed = dispute.openedById === user.id || dispute.order.buyerId === user.id || dispute.order.store.ownerId === user.id || user.role === 'ADMIN';
  if (!allowed) throw notFound('Litige introuvable.');
  return dispute;
}

disputeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const where =
      user.role === 'ADMIN'
        ? {}
        : { OR: [{ openedById: user.id }, { order: { buyerId: user.id } }, { order: { store: { ownerId: user.id } } }] };
    const items = await prisma.toumaDispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { order: { select: { id: true, orderNumber: true, total: true, currency: true, storeId: true } } },
    });
    res.json({ items: items.map((d) => ({ ...d, refundAmount: d.refundAmount?.toString() ?? null, order: { ...d.order, total: d.order.total.toString() } })) });
  }),
);

disputeRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(openSchema, req);
    const order = await prisma.toumaOrder.findUnique({ where: { id: input.orderId }, include: { store: true, disputes: true } });
    if (!order) throw notFound('Commande introuvable.');
    if (order.buyerId !== user.id && order.store.ownerId !== user.id) throw notFound('Commande introuvable.');
    if (order.status === 'PENDING') throw badRequest('Un litige ne peut être ouvert qu’après paiement.');
    if (order.disputes.some((d) => ['OPEN', 'UNDER_REVIEW'].includes(d.status))) {
      throw conflict('Un litige est déjà ouvert sur cette commande.');
    }

    const dispute = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaDispute.create({
        data: {
          orderId: order.id,
          openedById: user.id,
          reason: input.reason,
          details: input.details ?? null,
          evidence: { create: input.evidence.map((e) => ({ kind: e.kind, url: e.url, note: e.note ?? null })) },
        },
      });
      await tx.toumaOrder.update({ where: { id: order.id }, data: { status: 'DISPUTED' } });
      return created;
    });

    const counterpartId = order.buyerId === user.id ? order.store.ownerId : order.buyerId;
    await notify({
      userId: counterpartId,
      type: 'DISPUTE_OPENED',
      title: 'Litige ouvert',
      body: `Un litige a été ouvert sur la commande ${order.orderNumber}.`,
      data: { orderId: order.id, disputeId: dispute.id },
    });
    await auditRequest(req, 'dispute.open', 'ToumaDispute', dispute.id, { orderId: order.id, reason: input.reason });
    res.status(201).json(dispute);
  }),
);

disputeRouter.get('/:id', asyncHandler(async (req, res) => res.json(await loadDispute(req.params.id, currentUser(req)))));

disputeRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const dispute = await loadDispute(req.params.id, user);
    if (['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'].includes(dispute.status)) {
      throw conflict('Ce litige est clos.');
    }
    const input = parseBody(messageSchema, req);
    // Un message interne est réservé à l'administration.
    const internal = input.internal && user.role === 'ADMIN';
    const message = await prisma.toumaDisputeMessage.create({
      data: { disputeId: dispute.id, authorId: user.id, body: input.body, internal },
    });
    res.status(201).json(message);
  }),
);

/** Décision d'administration : auditée, avec remboursement éventuel. */
disputeRouter.post(
  '/:id/resolve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(resolveSchema, req);
    const dispute = await prisma.toumaDispute.findUnique({ where: { id: req.params.id }, include: { order: { include: { store: true } } } });
    if (!dispute) throw notFound('Litige introuvable.');
    if (['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'].includes(dispute.status)) {
      throw conflict('Ce litige est déjà tranché.');
    }

    const updated = await prisma.toumaDispute.update({
      where: { id: dispute.id },
      data: {
        status: input.decision,
        resolution: input.resolution,
        refundAmount: input.refundAmount ? new Prisma.Decimal(input.refundAmount) : null,
        resolvedAt: new Date(),
      },
    });

    await audit({
      actorId: admin.id,
      action: 'dispute.resolve',
      entity: 'ToumaDispute',
      entityId: dispute.id,
      metadata: { decision: input.decision, refundAmount: input.refundAmount ?? null, orderId: dispute.orderId },
      ip: req.ip,
    });
    await Promise.all([
      notify({
        userId: dispute.order.buyerId,
        type: 'DISPUTE_RESOLVED',
        title: 'Litige tranché',
        body: `Décision Touma sur la commande ${dispute.order.orderNumber} : ${input.decision}.`,
        data: { disputeId: dispute.id, orderId: dispute.orderId },
      }),
      notify({
        userId: dispute.order.store.ownerId,
        type: 'DISPUTE_RESOLVED',
        title: 'Litige tranché',
        body: `Décision Touma sur la commande ${dispute.order.orderNumber} : ${input.decision}.`,
        data: { disputeId: dispute.id, orderId: dispute.orderId },
      }),
    ]);
    res.json({ ...updated, refundAmount: updated.refundAmount?.toString() ?? null });
  }),
);
