import { z } from 'zod';

/** Montants en chaîne décimale : un float perdrait des centimes. */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const businessProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  registrationNo: z.string().trim().max(80).optional(),
  taxId: z.string().trim().max(80).optional(),
  sector: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().toUpperCase().length(2),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  website: z.string().trim().url().max(200).optional(),
  annualVolume: z.string().trim().max(60).optional(),
});

export const rfqItemSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  quantity: z.number().int().min(1).max(100_000_000),
  unit: z.string().trim().min(1).max(30).default('pièce'),
  targetUnitPrice: amount.optional(),
  categoryId: z.string().cuid().optional(),
});

export const createRfqSchema = z.object({
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().max(4000).default(''),
  /** Pays de livraison souhaité. */
  countryCode: z.string().trim().toUpperCase().length(2),
  city: z.string().trim().max(120).optional(),
  /** Pays d'origine souhaité pour la marchandise (facultatif). */
  sourceCountry: z.string().trim().toUpperCase().length(2).optional(),
  currency: z.string().trim().toUpperCase().length(3),
  /** Date limite de réception des offres (ISO-8601). */
  deadline: z.string().datetime().optional(),
  items: z.array(rfqItemSchema).min(1, 'Décrivez au moins un produit recherché.').max(20),
});

export const listRfqsSchema = z.object({
  /** `mine` = mes appels d'offres ; `open` = ceux auxquels je peux répondre. */
  /** `mine` = mes appels d'offres ; `open` = ouverts ; `invited` = ceux où mes boutiques sont sollicitées. */
  scope: z.enum(['mine', 'open', 'invited']).default('open'),
  country: z.string().trim().toUpperCase().length(2).optional(),
  status: z.enum(['OPEN', 'QUOTED', 'AWARDED', 'CLOSED', 'EXPIRED', 'CANCELLED']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const quoteItemSchema = z.object({
  rfqItemId: z.string().cuid().optional(),
  name: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(100_000_000),
  unit: z.string().trim().min(1).max(30).default('pièce'),
  unitPrice: amount,
});

export const createQuoteSchema = z.object({
  storeId: z.string().cuid(),
  shippingTotal: amount.default('0'),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  /** Durée de validité de l'offre, en jours. */
  validityDays: z.number().int().min(1).max(120).default(14),
  message: z.string().trim().max(2000).optional(),
  items: z.array(quoteItemSchema).min(1).max(20),
});

export const negotiationSchema = z.object({
  kind: z.enum(['MESSAGE', 'COUNTER_OFFER']).default('MESSAGE'),
  body: z.string().trim().min(1).max(2000),
  /** Total proposé lors d'une contre-proposition. */
  proposedTotal: amount.optional(),
});

export type CreateRfqInput = z.infer<typeof createRfqSchema>;
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type ListRfqsQuery = z.infer<typeof listRfqsSchema>;

/** Invitation de fournisseurs repérés par le sourcing à répondre à une demande. */
export const inviteSuppliersSchema = z.object({
  storeIds: z.array(z.string().cuid()).min(1, 'Choisissez au moins un fournisseur.').max(20),
  message: z.string().trim().max(1000).default(''),
});

export type InviteSuppliersInput = z.infer<typeof inviteSuppliersSchema>;
