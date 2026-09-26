import { z } from 'zod';

/** Codes de réduction — schémas d'entrée. */

const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const couponCode = z
  .string()
  .trim()
  .min(3)
  .max(40)
  // Normalisation en majuscules : « bienvenue10 » et « BIENVENUE10 » sont le même code.
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9_-]+$/.test(v), 'Un code ne contient que des lettres, chiffres, tirets et soulignés.');

export const createCouponSchema = z
  .object({
    code: couponCode,
    type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']),
    /** Pourcentage (0–100) ou montant fixe. Ignoré pour la livraison offerte. */
    value: amount.optional(),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    description: z.string().trim().max(300).default(''),
    /** Boutique propriétaire : une promotion de vendeur réduit son propre revenu. */
    storeId: z.string().cuid().optional(),
    minOrderAmount: amount.optional(),
    maxDiscountAmount: amount.optional(),
    countryCodes: z.array(z.string().trim().toUpperCase().length(2)).max(20).default([]),
    firstOrderOnly: z.boolean().default(false),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).optional(),
    usageLimitPerUser: z.number().int().min(1).max(1000).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === 'PERCENTAGE') {
      const value = Number(input.value ?? 0);
      if (!input.value || value <= 0 || value > 100) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Un pourcentage se situe entre 0 et 100.' });
      }
    }
    if (input.type === 'FIXED_AMOUNT') {
      if (!input.value || Number(input.value) <= 0) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Indiquez le montant de la remise.' });
      }
      // Sans devise, un montant fixe serait appliqué à l'aveugle sur n'importe quel panier.
      if (!input.currency) {
        ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Une remise en montant exige sa devise.' });
      }
    }
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'La fin doit suivre le début.' });
    }
  });

export const updateCouponSchema = z.object({
  description: z.string().trim().max(300).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  endsAt: z.string().datetime().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

export const listCouponsSchema = z.object({
  /** `store` = les codes de mes boutiques ; `platform` = ceux de TOUMA (admin). */
  scope: z.enum(['store', 'platform']).default('store'),
  storeId: z.string().cuid().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'EXPIRED', 'EXHAUSTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Simulation d'un code sur le panier courant, avant validation de commande. */
export const previewSchema = z.object({
  code: couponCode,
  /** Pays de livraison envisagé : certaines promotions y sont limitées. */
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ListCouponsQuery = z.infer<typeof listCouponsSchema>;
