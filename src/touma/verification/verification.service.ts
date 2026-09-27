import { prisma } from '../../db/prisma.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * TOUMA VERIFIED — confiance vendeur.
 *
 * Les documents fournis sont **privés** : ils ne sortent jamais des réponses
 * publiques et ne sont visibles que du vendeur propriétaire et de l'équipe de
 * revue. Toute décision d'administration est auditée.
 */

export interface VerificationInput {
  storeId: string;
  businessType: 'INDIVIDUAL' | 'COMPANY';
  legalName: string;
  registrationNo?: string;
  taxId?: string;
  contactPhone: string;
  contactEmail: string;
  documents: Array<{ kind: string; url: string }>;
}

/** Vue vendeur : le détail des documents est réduit à leur nature et leur nombre. */
function sellerView(v: { id: string; status: string; businessType: string; legalName: string; reviewerComment: string | null; submittedAt: Date; reviewedAt: Date | null; documents: unknown }) {
  const docs = Array.isArray(v.documents) ? (v.documents as Array<{ kind?: string }>) : [];
  return {
    id: v.id,
    status: v.status,
    businessType: v.businessType,
    legalName: v.legalName,
    reviewerComment: v.reviewerComment,
    submittedAt: v.submittedAt,
    reviewedAt: v.reviewedAt,
    documentCount: docs.length,
    documentKinds: docs.map((d) => d.kind ?? 'document'),
  };
}

export const verificationService = {
  /** Dépôt d'un dossier par le vendeur (un dossier en cours à la fois). */
  async submit(user: ToumaRequestUser, input: VerificationInput) {
    const store = await prisma.toumaStore.findUnique({ where: { id: input.storeId } });
    if (!store) throw notFound('Boutique introuvable.');
    if (store.ownerId !== user.id) throw forbidden('Vous ne pouvez soumettre un dossier que pour votre boutique.');

    const pending = await prisma.toumaSellerVerification.findFirst({ where: { storeId: store.id, status: 'PENDING' } });
    if (pending) throw conflict('Un dossier de vérification est déjà en cours d’examen.');
    if (store.verificationStatus === 'APPROVED') throw conflict('Cette boutique est déjà vérifiée.');

    const verification = await prisma.$transaction(async (tx) => {
      const created = await tx.toumaSellerVerification.create({
        data: {
          storeId: store.id,
          businessType: input.businessType,
          legalName: input.legalName,
          registrationNo: input.registrationNo ?? null,
          taxId: input.taxId ?? null,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          documents: input.documents.map((d) => ({ ...d, uploadedAt: new Date().toISOString() })) as object,
        },
      });
      await tx.toumaStore.update({ where: { id: store.id }, data: { verificationStatus: 'PENDING' } });
      return created;
    });

    await Promise.all([
      audit({ actorId: user.id, action: 'verification.submit', entity: 'ToumaSellerVerification', entityId: verification.id, metadata: { storeId: store.id } }),
      notify({
        userId: user.id,
        type: 'VERIFICATION_SUBMITTED',
        title: 'Dossier Touma Verified reçu',
        body: `Votre dossier pour « ${store.name} » est en cours d'examen.`,
        data: { storeId: store.id, verificationId: verification.id },
      }),
    ]);
    return sellerView(verification);
  },

  /** Statut des dossiers du vendeur connecté. */
  async status(user: ToumaRequestUser, storeId?: string) {
    const stores = await prisma.toumaStore.findMany({
      where: { ownerId: user.id, ...(storeId ? { id: storeId } : {}) },
      select: { id: true, name: true, verificationStatus: true, verifications: { orderBy: { submittedAt: 'desc' }, take: 5 } },
    });
    return stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      verificationStatus: s.verificationStatus,
      submissions: s.verifications.map(sellerView),
    }));
  },

  /** File d'attente des dossiers (administration). */
  async queue(status: string | undefined, page: { skip: number; take: number }) {
    const where = status ? { status: status as 'PENDING' } : { status: 'PENDING' as const };
    const [items, total] = await Promise.all([
      prisma.toumaSellerVerification.findMany({
        where,
        include: { store: { select: { id: true, name: true, slug: true, countryCode: true, owner: { select: { id: true, name: true, email: true } } } } },
        orderBy: { submittedAt: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      prisma.toumaSellerVerification.count({ where }),
    ]);
    return { items, total };
  },

  /** Décision d'administration : approbation ou rejet, toujours auditée. */
  async decide(admin: ToumaRequestUser, verificationId: string, decision: 'APPROVED' | 'REJECTED', comment?: string) {
    if (admin.role !== 'ADMIN') throw forbidden('Décision réservée à l’administration Touma.');
    const verification = await prisma.toumaSellerVerification.findUnique({ where: { id: verificationId }, include: { store: true } });
    if (!verification) throw notFound('Dossier introuvable.');
    if (verification.status !== 'PENDING') throw conflict('Ce dossier a déjà été traité.');

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.toumaSellerVerification.update({
        where: { id: verification.id },
        data: { status: decision, reviewerId: admin.id, reviewerComment: comment ?? null, reviewedAt: new Date() },
      });
      await tx.toumaStore.update({ where: { id: verification.storeId }, data: { verificationStatus: decision } });
      return v;
    });

    await Promise.all([
      audit({
        actorId: admin.id,
        action: decision === 'APPROVED' ? 'verification.approve' : 'verification.reject',
        entity: 'ToumaSellerVerification',
        entityId: verification.id,
        metadata: { storeId: verification.storeId, comment: comment ?? null },
      }),
      notify({
        userId: verification.store.ownerId,
        type: decision === 'APPROVED' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        title: decision === 'APPROVED' ? 'Boutique vérifiée ✅' : 'Dossier de vérification refusé',
        body:
          decision === 'APPROVED'
            ? `« ${verification.store.name} » est désormais vendeur vérifié Touma.`
            : `Votre dossier a été refusé : ${comment ?? 'motif non précisé'}.`,
        data: { storeId: verification.storeId },
      }),
    ]);
    return sellerView(updated);
  },
};
