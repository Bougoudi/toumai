import { prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { NotificationCategory } from '../lib/notifications.js';
import type { ToumaRequestUser } from '../middleware/toumaAuth.js';

/**
 * Raccourcis commerciaux et réponses enregistrées.
 *
 * Dans une négociation B2B, les mêmes cinq questions reviennent toujours :
 * le prix, la quantité minimale, le délai, le transport, la remise au volume.
 * Les proposer d'un clic fait gagner un aller-retour à chaque échange — et
 * pousse l'acheteur à demander *les bonnes* informations.
 */

export interface CommercialShortcut {
  code: string;
  label: string;
  /** Message pré-rempli, que l'utilisateur reste libre de modifier. */
  content: string;
}

/** Raccourcis proposés à tous, dans les deux sens de la relation. */
export const COMMERCIAL_SHORTCUTS: { buyer: CommercialShortcut[]; seller: CommercialShortcut[] } = {
  buyer: [
    { code: 'price', label: 'Demander le prix', content: 'Bonjour, quel est votre meilleur prix unitaire pour cette référence ?' },
    { code: 'moq', label: 'Demander la quantité minimale', content: 'Bonjour, quelle est votre quantité minimale de commande (MOQ) ?' },
    { code: 'lead-time', label: 'Demander le délai', content: 'Quel est votre délai de mise à disposition, et sous combien de jours pouvez-vous livrer ?' },
    { code: 'shipping', label: 'Demander les frais de livraison', content: 'Quels sont les frais de livraison jusqu’à ma ville, et quel transporteur utilisez-vous ?' },
    { code: 'volume', label: 'Demander une remise au volume', content: 'Pouvez-vous proposer une remise pour une commande de 1 000 unités ?' },
    { code: 'sample', label: 'Demander un échantillon', content: 'Pouvez-vous envoyer un échantillon avant une commande ferme, et à quel coût ?' },
  ],
  seller: [
    { code: 'availability', label: 'Confirmer la disponibilité', content: 'Bonjour, la quantité demandée est disponible en stock. Souhaitez-vous que je vous adresse une offre chiffrée ?' },
    { code: 'need-details', label: 'Demander des précisions', content: 'Pour chiffrer précisément, pouvez-vous préciser la quantité exacte, la ville de livraison et l’échéance souhaitée ?' },
    { code: 'lead-time', label: 'Annoncer le délai', content: 'Nous pouvons préparer la commande sous X jours, livraison comprise.' },
    { code: 'counter', label: 'Proposer une révision', content: 'Je peux ajuster mon prix sur ce volume. Je vous adresse une offre révisée.' },
  ],
};

export const templatesService = {
  /** Raccourcis + réponses enregistrées de l'utilisateur. */
  async list(user: ToumaRequestUser) {
    const saved = await prisma.toumaSavedReply.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return {
      shortcuts: user.role === 'SELLER' ? COMMERCIAL_SHORTCUTS.seller : COMMERCIAL_SHORTCUTS.buyer,
      saved: saved.map((s) => ({ id: s.id, title: s.title, content: s.content, updatedAt: s.updatedAt })),
    };
  },

  async create(user: ToumaRequestUser, input: { title: string; content: string }) {
    const count = await prisma.toumaSavedReply.count({ where: { ownerId: user.id } });
    if (count >= 50) throw badRequest('Cinquante réponses enregistrées au maximum.');
    const created = await prisma.toumaSavedReply.create({
      data: { ownerId: user.id, title: input.title, content: input.content },
    });
    return { id: created.id, title: created.title, content: created.content, updatedAt: created.updatedAt };
  },

  async update(user: ToumaRequestUser, id: string, input: { title?: string; content?: string }) {
    const existing = await prisma.toumaSavedReply.findFirst({ where: { id, ownerId: user.id } });
    if (!existing) throw notFound('Réponse enregistrée introuvable.');
    const updated = await prisma.toumaSavedReply.update({
      where: { id: existing.id },
      data: { ...(input.title ? { title: input.title } : {}), ...(input.content ? { content: input.content } : {}) },
    });
    return { id: updated.id, title: updated.title, content: updated.content, updatedAt: updated.updatedAt };
  },

  async remove(user: ToumaRequestUser, id: string) {
    const deleted = await prisma.toumaSavedReply.deleteMany({ where: { id, ownerId: user.id } });
    if (deleted.count === 0) throw notFound('Réponse enregistrée introuvable.');
    return { id, deleted: true };
  },
};

const CATEGORIES: NotificationCategory[] = ['MESSAGES', 'NEGOTIATION', 'RFQ', 'ORDERS', 'MARKETING'];

/**
 * Préférences de notification. Valeurs par défaut explicites : in-app activé
 * partout sauf le marketing, e-mail nulle part tant qu'aucun expéditeur n'est
 * configuré — promettre un e-mail qu'on n'enverra pas serait pire que rien.
 */
export const notificationPreferenceService = {
  async list(userId: string) {
    const rows = await prisma.toumaNotificationPreference.findMany({ where: { userId } });
    const bySlug = new Map(rows.map((r) => [r.category, r]));
    return {
      items: CATEGORIES.map((category) => {
        const row = bySlug.get(category);
        return {
          category,
          inApp: row?.inApp ?? category !== 'MARKETING',
          email: row?.email ?? false,
        };
      }),
      /** Tant qu'aucun canal e-mail n'est branché, l'interface le dit. */
      emailAvailable: Boolean(process.env.TOUMA_EMAIL_PROVIDER),
    };
  },

  async update(userId: string, category: string, input: { inApp?: boolean; email?: boolean }) {
    if (!CATEGORIES.includes(category as NotificationCategory)) throw badRequest('Catégorie inconnue.');
    const saved = await prisma.toumaNotificationPreference.upsert({
      where: { userId_category: { userId, category } },
      update: { ...(input.inApp === undefined ? {} : { inApp: input.inApp }), ...(input.email === undefined ? {} : { email: input.email }) },
      create: { userId, category, inApp: input.inApp ?? true, email: input.email ?? false },
    });
    return { category: saved.category, inApp: saved.inApp, email: saved.email };
  },
};
