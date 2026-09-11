import { z } from 'zod';

/**
 * Les montants transitent en **chaîne** (« 25000.00 ») : un JSON `number`
 * flottant perdrait de la précision. Ils sont convertis en Decimal côté service.
 */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Montant invalide (format attendu : 12345.67).');

export const imageSchema = z.object({
  url: z.string().trim().url().max(500),
  alt: z.string().trim().max(200).optional(),
  position: z.number().int().min(0).default(0),
});

export const variantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).optional(),
  priceDelta: amount.default('0'),
  quantity: z.number().int().min(0).default(0),
  position: z.number().int().min(0).default(0),
});

export const createProductSchema = z.object({
  storeId: z.string().cuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10000).default(''),
  brand: z.string().trim().max(120).optional(),
  sku: z.string().trim().max(60).optional(),
  price: amount,
  compareAtPrice: amount.optional(),
  /** Devise ISO-4217 ; par défaut celle du pays de la boutique. */
  currency: z.string().trim().toUpperCase().length(3).optional(),
  categoryId: z.string().cuid().optional(),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  minOrderQty: z.number().int().min(1).max(100000).default(1),
  weightGrams: z.number().int().min(1).max(2_000_000).default(500),
  keywords: z.string().trim().max(500).default(''),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
  quantity: z.number().int().min(0).default(0),
  images: z.array(imageSchema).max(12).default([]),
  variants: z.array(variantSchema).max(50).default([]),
});

export const updateProductSchema = createProductSchema
  .omit({ storeId: true, variants: true })
  .partial()
  .extend({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional() });

export const listProductsSchema = z.object({
  // Les espaces multiples d'un copier-coller casseraient la recherche
  // (« cacao   brut » ne correspondrait à aucun titre).
  q: z.string().trim().max(200).transform((v) => v.replace(/\s+/g, ' ')).optional(),
  category: z.string().trim().max(120).optional(),
  country: z.string().trim().toUpperCase().length(2).optional(),
  store: z.string().trim().max(120).optional(),
  minPrice: amount.optional(),
  maxPrice: amount.optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'any']).default('any'),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'popular', 'relevance']).default('recent'),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;
