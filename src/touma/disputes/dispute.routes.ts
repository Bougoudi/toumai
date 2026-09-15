import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { evidenceService } from './evidence.service.js';
import { computePriority, deadlineFrom, sweepDisputes } from './escalation.js';
import { entriesFor, holdForDispute, releaseHold } from '../finance/ledger.js';
import { readAttachment, safeContentType } from '../messaging/attachments.js';
import { asyncHandler, parseBody } from '../../middleware/validate.js';
import { audit, auditRequest } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import { authenticate, currentUser, requireAdmin } from '../middleware/toumaAuth.js';
import { reputationService } from '../reputation/reputation.service.js';
import { refreshGroupStatus } from '../orders/group-status.js';

/**
 * Litiges Touma. Acheteur et vendeur échangent messages et preuves ; seule
 * l'administration tranche, et sa décision est systématiquement auditée.
 */
export const disputeRouter = Router();

const openSchema = z.object({
  orderId: z.string().cuid(),
  reason: z.enum(['NOT_RECEIVED', 'DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'OTHER']),
  details: z.string().trim().max(2000).optional(),
  category: z
    .enum(['NON_DELIVERY', 'LATE_DELIVERY', 'DAMAGED_ITEM', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'QUALITY', 'MISSING_QUANTITY', 'PAYMENT', 'REFUND', 'FRAUD', 'OTHER'])
    .default('OTHER'),
  /**
   * Les preuves ne s'envoient plus ici. Une URL déclarée par un navigateur ne
   * prouve rien : le fichier vit chez un tiers, personne ne l'a vérifié, et son
   * déposant peut le remplacer après la décision. Elles passent désormais par
   * `POST /disputes/:id/evidence`, en corps brut.
   */
  evidence: z
    .never({ invalid_type_error: 'Versez les pièces via POST /disputes/:id/evidence (corps brut).' })
    .optional(),
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000), internal: z.boolean().default(false) });

const resolveSchema = z.object({
  decision: z.enum(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED']),
  resolution: z.string().trim().max(2000),
  refundAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  resolutionType: z
    .enum(['BUYER_REFUND_FULL', 'BUYER_REFUND_PARTIAL', 'RETURN_AND_REFUND', 'REPLACEMENT', 'NO_REFUND', 'SELLER_FAVOR', 'BUYER_FAVOR', 'MUTUAL_AGREEMENT', 'OTHER'])
    .optional(),
});

/**
 * Sert le contenu d'une preuve.
 *
 * Cette route manquait : une preuve pouvait être versée et listée, et son lien
 * ne menait nulle part — il pointait vers la table des pièces jointes de la
 * messagerie, où l'identifiant d'une preuve ne se trouve évidemment pas. Une
 * preuve qu'on ne peut pas ouvrir ne prouve rien, et c'est l'arbitre qui en
 * paie le prix : il décidait sur une pièce qu'il ne pouvait pas regarder.
 *
 * Deux chemins d'accès, une seule règle : **seules les parties du dossier**
 * voient le fichier — par contrôle d'appartenance, ou par signature à durée
 * courte. Déclarée avant `authenticate` parce qu'un lien signé ne porte aucun
 * jeton.
 */
disputeRouter.get(
  '/evidence/:evidenceId',
  (req, res, next) => {
    const signe = typeof req.query.expires === 'string' && typeof req.query.signature === 'string';
    if (signe) return next();
    return authenticate(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const expires = typeof req.query.expires === 'string' ? req.query.expires : null;
    const sig = typeof req.query.signature === 'string' ? req.query.signature : null;

    const evidence = await evidenceService.content(
      req.params.evidenceId,
      req.toumaUser ?? null,
      expires && sig ? { expires, signature: sig } : undefined,
    );

    const content = await readAttachment(evidence.storageKey);
    // Jamais rendu comme document actif : téléchargement, sans reniflage de type.
    res.setHeader('content-type', safeContentType(evidence.mimeType));
    res.setHeader('content-disposition', `attachment; filename="${evidence.filename.replace(/"/g, '')}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, max-age=60');
    res.send(content);
  }),
);

disputeRouter.use(authenticate);

// Les délais dépassés sont constatés côté serveur, sur le chemin de la
// consultation : une escalade qui dépendrait d'un onglet ouvert n'arriverait
// jamais pour celui qui a fermé le sien.
disputeRouter.use(
  asyncHandler(async (_req, _res, next) => {
    await sweepDisputes();
    next();
  }),
);

/**
 * Accès : acheteur, vendeur concerné ou administration.
 *
 * Deux choses ne sortent jamais vers une partie, et les deux étaient sorties.
 *
 * **La note interne de l'assistance.** Elle existe pour qu'un dossier puisse
 * être annoté sans que les parties lisent par-dessus l'épaule de celui qui
 * l'instruit. Le filtre était posé à l'écriture — un non-administrateur ne peut
 * pas en créer — et nulle part à la lecture.
 *
 * **La clé de stockage d'une preuve.** C'est le nom de l'objet dans le stockage
 * privé : non devinable par construction, et c'est cette imprévisibilité qui
 * protège le fichier. Dans un litige, l'autre partie est un adversaire. Le
 * service de preuves la retirait déjà de ses réponses ; le dossier complet la
 * laissait passer, ce qui revenait à annuler la précaution par une autre porte.
 */
async function loadDispute(id: string, user: { id: string; role: string }) {
  const estAdmin = user.role === 'ADMIN';
  const dispute = await prisma.toumaDispute.findUnique({
    where: { id },
    include: {
      order: { include: { store: true } },
      messages: {
        where: estAdmin ? {} : { internal: false },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      // Champs choisis un par un : `true` ferait entrer toute nouvelle colonne
      // du modèle dans la réponse sans que personne ne l'ait décidé.
      evidence: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          checksum: true,
          note: true,
          createdAt: true,
          removedAt: true,
          removalReason: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      },
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

    // Priorité : un ordre de passage pour l'assistance, jamais une décision.
    const litigesPrecedents = await prisma.toumaDispute.count({
      where: { order: { storeId: order.storeId }, status: { notIn: ['REJECTED', 'CLOSED'] } },
    });
    const priority = computePriority({
      amount: order.total,
      category: input.category,
      previousDisputesOnStore: litigesPrecedents,
    });
    const ouvertParAcheteur = order.buyerId === user.id;

    const dispute = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaDispute.create({
        data: {
          orderId: order.id,
          openedById: user.id,
          reason: input.reason,
          category: input.category,
          priority,
          details: input.details ?? null,
          // La balle est dans le camp de l'autre partie, avec un délai. Le
          // silence n'est plus une échappatoire : passé ce terme, un balayage
          // serveur porte le dossier devant l'assistance — sans rien trancher.
          status: ouvertParAcheteur ? 'SELLER_RESPONSE_REQUIRED' : 'BUYER_RESPONSE_REQUIRED',
          sellerResponseDeadline: ouvertParAcheteur ? deadlineFrom() : null,
          buyerResponseDeadline: ouvertParAcheteur ? null : deadlineFrom(),

        },
      });
      await tx.toumaOrder.update({ where: { id: order.id }, data: { status: 'DISPUTED' } });
      // Les fonds de cette commande ne doivent plus partir tant que le dossier
      // n'est pas tranché. Ce n'est pas une sanction : c'est l'argent qui reste
      // en place le temps qu'un humain regarde.
      await holdForDispute(order.id, created.id, tx);
      return created;
    });

    // Un litige pèse dans la réputation de la boutique : son instantané est périmé.
    await reputationService.invalidate(order.storeId);

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

/**
 * Mouvements d'argent d'un litige : la vente, la commission, les
 * remboursements, et ce qui est retenu. C'est la réponse à « où est passé mon
 * argent », que ni l'acheteur ni le vendeur ne pouvaient obtenir jusqu'ici.
 */
disputeRouter.get(
  '/:id/ledger',
  asyncHandler(async (req, res) => {
    const dispute = await loadDispute(req.params.id, currentUser(req));
    res.json({ items: await entriesFor('ToumaOrder', dispute.orderId) });
  }),
);

/** Décode un en-tête encodé par le client (`encodeURIComponent`). */
function decodeHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Verse une pièce au dossier. Corps **brut** : le type réel est déduit du
 * contenu, jamais de l'en-tête. C'est le même mécanisme que les pièces jointes
 * de la messagerie, et pour la même raison — sauf qu'ici, une pièce non vérifiée
 * ne coûte pas un malentendu mais une décision d'argent prise sur du vent.
 */
disputeRouter.post(
  '/:id/evidence',
  asyncHandler(async (req, res) => {
    const content = req.body;
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw badRequest('Envoyez la pièce en corps brut (content-type: application/octet-stream).');
    }
    const filename = decodeHeader(req.get('x-file-name')) ?? 'preuve';
    const note = decodeHeader(req.get('x-note'));
    const kind = (req.get('x-evidence-kind') ?? 'PHOTO') as never;

    const evidence = await evidenceService.add(currentUser(req), { disputeId: req.params.id }, content, { filename, kind, note });
    await auditRequest(req, 'dispute.evidence.upload', 'ToumaDispute', req.params.id, { evidenceId: evidence.id });
    res.status(201).json(evidence);
  }),
);

disputeRouter.get(
  '/:id/evidence',
  asyncHandler(async (req, res) => res.json(await evidenceService.list(currentUser(req), { disputeId: req.params.id }))),
);

/**
 * Écarte une pièce. Réservé à l'administration, et la pièce n'est pas
 * supprimée : elle est marquée écartée, avec son motif. On ne retire pas une
 * pièce d'un dossier après coup — on note qu'elle a été écartée.
 */
disputeRouter.post(
  '/evidence/:evidenceId/remove',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const result = await evidenceService.remove(currentUser(req), req.params.evidenceId, reason);
    await auditRequest(req, 'dispute.evidence.remove', 'ToumaDisputeEvidence', req.params.evidenceId, {});
    res.json(result);
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

    // Les pièces encore au dossier au moment de la décision : c'est sur
    // celles-là que la décision a été prise, et sur aucune autre.
    const piecesRetenues = await prisma.toumaDisputeEvidence.findMany({
      where: { disputeId: dispute.id, removedAt: null },
      select: { id: true, checksum: true, filename: true },
    });

    const updated = await prisma.toumaDispute.update({
      where: { id: dispute.id },
      data: {
        status: input.decision,
        resolution: input.resolution,
        refundAmount: input.refundAmount ? new Prisma.Decimal(input.refundAmount) : null,
        resolutionType: input.resolutionType ?? null,
        // Instantané figé de la décision. Sans lui, une résolution se réécrit
        // en silence — et six mois plus tard, personne ne sait sur quoi elle
        // reposait. On y met ce qui a été décidé, par qui, et sur quelles
        // pièces : les empreintes, pas les fichiers.
        resolutionSnapshot: {
          decidedAt: new Date().toISOString(),
          decidedBy: admin.id,
          decision: input.decision,
          resolutionType: input.resolutionType ?? null,
          amount: input.refundAmount ?? null,
          currency: dispute.order.currency,
          notes: input.resolution,
          evidence: piecesRetenues.map((e) => ({ id: e.id, checksum: e.checksum, filename: e.filename })),
        } as object,
        resolvedAt: new Date(),
      },
    });

    // Les fonds retenus par ce litige sont libérés : la ligne n'est pas
    // réécrite, elle est datée. L'historique doit pouvoir dire « ces fonds ont
    // été retenus du 3 au 17 ».
    await releaseHold(dispute.id);

    // **La commande sort de l'état « en litige ».** Ouvrir un litige y fait
    // passer la commande ; rien ne l'en faisait ressortir. Elle y restait donc
    // pour toujours, même une fois la décision rendue — la machine d'état
    // déclare pourtant DISPUTED → COMPLETED / REFUNDED. Conséquence concrète et
    // silencieuse : le vendeur n'était jamais réglé, puisqu'une commande
    // bloquée en litige ne devient jamais réglable.
    const autresLitiges = await prisma.toumaDispute.count({
      where: {
        orderId: dispute.orderId,
        id: { not: dispute.id },
        status: { in: ['OPEN', 'SELLER_RESPONSE_REQUIRED', 'BUYER_RESPONSE_REQUIRED', 'UNDER_REVIEW', 'MEDIATION', 'ESCALATED'] },
      },
    });
    if (autresLitiges === 0) {
      const commande = await prisma.toumaOrder.findUnique({
        where: { id: dispute.orderId },
        select: { id: true, status: true, total: true, deliveredAt: true },
      });
      if (commande?.status === 'DISPUTED') {
        const rembourse = await prisma.toumaRefund.aggregate({
          where: { orderId: commande.id, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
          _sum: { amount: true },
        });
        const total = rembourse._sum.amount ?? new Prisma.Decimal(0);
        // On ne devine pas : intégralement remboursée, elle est remboursée ;
        // livrée et non remboursée, elle est menée à son terme. Dans les autres
        // cas on laisse le statut tel quel plutôt que d'inventer une fin.
        const suite = total.greaterThanOrEqualTo(commande.total)
          ? 'REFUNDED'
          : commande.deliveredAt
            ? 'COMPLETED'
            : null;
        if (suite) {
          await prisma.toumaOrder.update({ where: { id: commande.id }, data: { status: suite } });
          await refreshGroupStatus(commande.id);
        }
      }
    }

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
