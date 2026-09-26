import { z } from 'zod';

/** Validation des entrées de la messagerie. Rien n'atteint le service sans passer par là. */

export const listConversationsSchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(['BUYER_SELLER', 'RFQ', 'QUOTE', 'ORDER', 'SUPPORT']).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'CLOSED', 'BLOCKED']).optional(),
  unread: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  rfqId: z.string().cuid().optional(),
  quoteId: z.string().cuid().optional(),
  orderId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const openConversationSchema = z.object({
  storeId: z.string().cuid(),
  orderId: z.string().cuid().optional(),
  rfqId: z.string().cuid().optional(),
  subject: z.string().trim().max(200).optional(),
  /** Premier message, facultatif : contacter un fournisseur en un seul geste. */
  message: z.string().trim().min(1).max(4000).optional(),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToId: z.string().cuid().optional(),
  /**
   * Refus explicite, et non silencieux, de l'ancien format V13.
   *
   * Une pièce jointe déclarée par le client (URL, type, taille) n'est
   * vérifiable en rien : n'importe qui pouvait annoncer « image/jpeg » pour
   * une page exécutable hébergée ailleurs. Accepter puis ignorer serait pire
   * — l'expéditeur croirait son fichier transmis.
   */
  attachments: z
    .array(z.unknown())
    .max(0, 'Envoyez les pièces jointes en corps brut sur POST /conversations/:id/attachments : une URL déclarée par le client ne peut être ni vérifiée ni protégée.')
    .optional(),
});

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const listMessagesSchema = z.object({
  before: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const participationSchema = z
  .object({
    archived: z.boolean().optional(),
    muted: z.boolean().optional(),
  })
  .refine((v) => v.archived !== undefined || v.muted !== undefined, 'Rien à modifier.');

export const searchMessagesSchema = z.object({
  q: z.string().trim().min(2).max(200).transform((v) => v.replace(/\s+/g, ' ')),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const reportMessageSchema = z.object({
  reason: z.enum(['SPAM', 'FRAUD', 'ABUSE', 'OFF_PLATFORM_PAYMENT', 'PROHIBITED_CONTENT', 'OTHER']),
  details: z.string().trim().max(1000).optional(),
});

export const blockUserSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().max(300).optional(),
});

export const savedReplySchema = z.object({
  title: z.string().trim().min(2).max(120),
  content: z.string().trim().min(2).max(2000),
});

export const savedReplyUpdateSchema = savedReplySchema.partial().refine((v) => v.title || v.content, 'Rien à modifier.');

export const notificationPreferenceSchema = z.object({
  category: z.enum(['MESSAGES', 'NEGOTIATION', 'RFQ', 'ORDERS', 'MARKETING']),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
});

export const moderationQuerySchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const riskQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLEARED', 'CONFIRMED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const resolveReportSchema = z.object({
  status: z.enum(['REVIEWED', 'ACTIONED', 'DISMISSED']),
  resolution: z.string().trim().max(1000).optional(),
  closeConversation: z.boolean().optional(),
});

/** Montants en chaîne décimale : un flottant perdrait des centimes. */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const offerLineSchema = z.object({
  rfqItemId: z.string().cuid().optional(),
  name: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(100_000_000),
  unit: z.string().trim().min(1).max(30).default('pièce'),
  unitPrice: amount,
});

/**
 * Contre-proposition : le client envoie des lignes et des frais, **jamais un
 * total**. Le serveur calcule — c'est ce qui garantit que le montant affiché
 * est le montant enregistré.
 */
export const counterOfferSchema = z.object({
  items: z.array(offerLineSchema).min(1).max(50),
  shippingTotal: amount.default('0'),
  leadTimeDays: z.number().int().min(1).max(365),
  validityDays: z.number().int().min(1).max(120).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const applyProposalSchema = z.object({ negotiationId: z.string().cuid().optional() });

export type ListConversationsQuery = z.infer<typeof listConversationsSchema>;
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;
