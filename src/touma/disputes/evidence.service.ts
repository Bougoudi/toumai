import type { EvidenceKind } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { signedUrl, storeAttachment, verifySignature } from '../messaging/attachments.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Preuves d'un litige ou d'un retour.
 *
 * **Pourquoi ce fichier existe.** Une preuve était jusqu'ici une URL déclarée
 * par un navigateur : rien n'était vérifié, le fichier vivait chez un tiers que
 * son déposant pouvait modifier *après* la décision, personne ne savait qui
 * l'avait versée, et l'URL était publique. Or c'est la pièce sur laquelle un
 * arbitre décide qui garde l'argent.
 *
 * Le contenu est désormais reçu en corps brut, reconnu **à ses octets**,
 * empreinté et rangé sous une clé non devinable — exactement le mécanisme écrit
 * en V14 pour les pièces jointes de la messagerie, réutilisé tel quel. Il n'y
 * avait rien à inventer ; il y avait à ne pas refaire une seconde fois.
 *
 * Deux règles propres au dossier :
 *
 * **Une preuve ne se modifie jamais.** Aucune fonction de mise à jour n'existe
 * ici.
 *
 * **Un retrait ne supprime rien.** Il marque la pièce retirée, avec son auteur
 * et son motif. On ne retire pas une pièce d'un dossier après qu'une décision a
 * été prise dessus — on note qu'elle a été écartée, et pourquoi.
 */

/** Qui peut voir et verser des pièces sur ce dossier. */
async function parties(
  user: ToumaRequestUser,
  input: { disputeId?: string; returnRequestId?: string },
): Promise<{ disputeId: string | null; returnRequestId: string | null; closed: boolean }> {
  if (input.disputeId) {
    const dispute = await prisma.toumaDispute.findUnique({
      where: { id: input.disputeId },
      select: { id: true, status: true, openedById: true, order: { select: { buyerId: true, store: { select: { ownerId: true } } } } },
    });
    // Anti-IDOR : le dossier d'autrui est « introuvable », jamais « interdit ».
    if (!dispute) throw notFound('Litige introuvable.');
    const autorise =
      dispute.openedById === user.id ||
      dispute.order.buyerId === user.id ||
      dispute.order.store.ownerId === user.id ||
      user.role === 'ADMIN';
    if (!autorise) throw notFound('Litige introuvable.');

    return {
      disputeId: dispute.id,
      returnRequestId: null,
      closed: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED'].includes(dispute.status),
    };
  }

  if (input.returnRequestId) {
    const retour = await prisma.toumaReturnRequest.findUnique({
      where: { id: input.returnRequestId },
      select: { id: true, status: true, buyerId: true, store: { select: { ownerId: true } } },
    });
    if (!retour) throw notFound('Demande de retour introuvable.');
    const autorise = retour.buyerId === user.id || retour.store.ownerId === user.id || user.role === 'ADMIN';
    if (!autorise) throw notFound('Demande de retour introuvable.');

    return {
      disputeId: null,
      returnRequestId: retour.id,
      closed: ['REFUNDED', 'CANCELLED', 'CLOSED', 'REJECTED'].includes(retour.status),
    };
  }

  throw badRequest('Indiquez le litige ou la demande de retour concernée.');
}

/**
 * Chemin qui sert le contenu d'une preuve. Distinct de celui des pièces jointes
 * de la messagerie : ce sont deux tables, et un lien pointé vers la mauvaise ne
 * trouve rien.
 */
const EVIDENCE_PATH = '/api/v1/disputes/evidence';

/** Nombre maximal de pièces par dossier et par personne. */
const MAX_PAR_PERSONNE = Number(process.env.TOUMA_EVIDENCE_MAX_PER_USER ?? 10);

export const evidenceService = {
  /**
   * Verse une pièce. Le contenu arrive en corps brut ; le type annoncé par le
   * client n'est pas retenu — seuls les octets décident.
   */
  async add(
    user: ToumaRequestUser,
    target: { disputeId?: string; returnRequestId?: string },
    content: Buffer,
    meta: { filename: string; kind?: EvidenceKind; note?: string },
  ) {
    const dossier = await parties(user, target);
    if (dossier.closed) throw conflict('Ce dossier est clos : aucune pièce ne peut plus y être versée.');

    const deja = await prisma.toumaDisputeEvidence.count({
      where: {
        uploadedById: user.id,
        removedAt: null,
        ...(dossier.disputeId ? { disputeId: dossier.disputeId } : { returnRequestId: dossier.returnRequestId }),
      },
    });
    if (deja >= MAX_PAR_PERSONNE) {
      throw badRequest(`Vous avez déjà versé ${MAX_PAR_PERSONNE} pièces à ce dossier.`);
    }

    const stored = await storeAttachment(content, meta.filename);

    const evidence = await prisma.toumaDisputeEvidence.create({
      data: {
        disputeId: dossier.disputeId,
        returnRequestId: dossier.returnRequestId,
        kind: meta.kind ?? 'PHOTO',
        uploadedById: user.id,
        storageKey: stored.storageKey,
        filename: stored.name,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        note: meta.note?.slice(0, 500) ?? null,
      },
      select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, checksum: true, note: true, createdAt: true },
    });

    await audit({
      actorId: user.id,
      action: 'evidence.uploaded',
      entity: 'ToumaDisputeEvidence',
      entityId: evidence.id,
      // L'empreinte au journal : c'est elle qui permettra plus tard de prouver
      // que la pièce consultée est bien celle qui a été versée.
      metadata: { checksum: evidence.checksum, dossier: dossier.disputeId ?? dossier.returnRequestId },
    });

    return { ...evidence, url: signedUrl(evidence.id, EVIDENCE_PATH).url };
  },

  /** Pièces d'un dossier, avec leurs liens signés à durée courte. */
  async list(user: ToumaRequestUser, target: { disputeId?: string; returnRequestId?: string }) {
    const dossier = await parties(user, target);

    const rows = await prisma.toumaDisputeEvidence.findMany({
      where: dossier.disputeId ? { disputeId: dossier.disputeId } : { returnRequestId: dossier.returnRequestId },
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
    });

    return {
      items: rows.map((r) => ({
        ...r,
        // Une pièce retirée reste visible dans la liste — avec son motif — mais
        // son contenu n'est plus servi.
        url: r.removedAt ? null : signedUrl(r.id, EVIDENCE_PATH).url,
      })),
    };
  },

  /**
   * Retire une pièce. Réservé à l'administration : ni l'acheteur ni le vendeur
   * ne peuvent faire disparaître une pièce du dossier — y compris la leur.
   */
  async remove(user: ToumaRequestUser, evidenceId: string, reason: string) {
    if (user.role !== 'ADMIN') throw forbidden('Seule l’administration peut écarter une pièce.');
    if (!reason.trim()) throw badRequest('Un motif est requis pour écarter une pièce.');

    const evidence = await prisma.toumaDisputeEvidence.findUnique({ where: { id: evidenceId }, select: { id: true, removedAt: true } });
    if (!evidence) throw notFound('Pièce introuvable.');
    if (evidence.removedAt) throw conflict('Cette pièce est déjà écartée.');

    const updated = await prisma.toumaDisputeEvidence.update({
      where: { id: evidenceId },
      data: { removedAt: new Date(), removedById: user.id, removalReason: reason.slice(0, 500) },
      select: { id: true, removedAt: true, removalReason: true },
    });

    await audit({
      actorId: user.id,
      action: 'evidence.removed',
      entity: 'ToumaDisputeEvidence',
      entityId: evidenceId,
      metadata: { reason: reason.slice(0, 200) },
    });

    return updated;
  },

  /**
   * Sert le contenu d'une pièce à une partie du dossier, ou au porteur d'un
   * lien signé encore valable.
   */
  async content(evidenceId: string, user: ToumaRequestUser | null, signature?: { expires: string; signature: string }) {
    const evidence = await prisma.toumaDisputeEvidence.findUnique({
      where: { id: evidenceId },
      select: { id: true, storageKey: true, filename: true, mimeType: true, removedAt: true, disputeId: true, returnRequestId: true },
    });
    if (!evidence) throw notFound('Pièce introuvable.');
    if (evidence.removedAt) throw notFound('Pièce introuvable.');

    const signatureValide = signature ? verifySignature(evidence.id, signature.expires, signature.signature) : false;
    if (!signatureValide) {
      if (!user) throw notFound('Pièce introuvable.');
      await parties(user, {
        disputeId: evidence.disputeId ?? undefined,
        returnRequestId: evidence.returnRequestId ?? undefined,
      });
    }

    return evidence;
  },
};
