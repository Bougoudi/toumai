import { z } from 'zod';

/**
 * Retours et remboursements — schémas d'entrée.
 *
 * Aucun montant n'est accepté du client pour un retour : il est recalculé à
 * partir des instantanés de la commande. Seule l'administration (ou le vendeur
 * sur sa propre commande) peut réduire le montant validé.
 */

const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const returnReasons = [
  'DAMAGED',
  'NOT_AS_DESCRIBED',
  'WRONG_ITEM',
  'MISSING_PARTS',
  'NOT_DELIVERED',
  'CHANGED_MIND',
  'OTHER',
] as const;

export const evidenceSchema = z.object({
  url: z.string().trim().url().max(2000),
  name: z.string().trim().max(200).default('preuve'),
  mimeType: z.string().trim().max(100).default('image/jpeg'),
});

export const createReturnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum(returnReasons),
  comment: z.string().trim().max(2000).default(''),
  items: z
    .array(
      z.object({
        orderItemId: z.string().cuid(),
        quantity: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1, 'Sélectionnez au moins un article à retourner.')
    .max(50),
  evidence: z.array(evidenceSchema).max(5).default([]),
});

export const listReturnsSchema = z.object({
  /** `buyer` = mes demandes ; `seller` = celles reçues par mes boutiques. */
  scope: z.enum(['buyer', 'seller']).default('buyer'),
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const approveReturnSchema = z.object({
  /** Montant validé, au plus égal au montant réclamé. Absent = intégralité. */
  approvedAmount: amount.optional(),
  note: z.string().trim().max(1000).optional(),
});

export const rejectReturnSchema = z.object({
  note: z.string().trim().min(5, 'Expliquez le refus à l’acheteur.').max(1000),
});

export const shipReturnSchema = z.object({
  trackingNumber: z.string().trim().min(3).max(80),
});

export const receiveReturnSchema = z.object({
  condition: z.string().trim().max(200).optional(),
  /** Remettre les articles en stock (par défaut oui si l'état le permet). */
  restock: z.boolean().default(true),
});

export const refundSchema = z.object({
  /** Montant à rembourser. Absent = montant validé de la demande de retour. */
  amount: amount.optional(),
  reason: z.string().trim().max(300).optional(),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ListReturnsQuery = z.infer<typeof listReturnsSchema>;
export type ApproveReturnInput = z.infer<typeof approveReturnSchema>;
export type ReceiveReturnInput = z.infer<typeof receiveReturnSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
