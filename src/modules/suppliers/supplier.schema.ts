import { z } from 'zod';

export const offerInputSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  keywords: z.string().default(''),
  unitPrice: z.number().positive().optional(),
  currency: z.string().default('EUR'),
  moq: z.number().int().positive().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  inStock: z.boolean().default(true),
});

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  country: z.string().optional(),
  region: z.string().optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  rating: z.number().min(0).max(5).default(0),
  verified: z.boolean().default(false),
  certifications: z.string().default(''),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minOrderValue: z.number().nonnegative().optional(),
  currency: z.string().default('EUR'),
  source: z.string().default('manual'),
  offers: z.array(offerInputSchema).default([]),
});

export const updateSupplierSchema = createSupplierSchema.partial().omit({ offers: true });

export const listSuppliersQuerySchema = z.object({
  region: z.string().optional(),
  q: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  verified: z.coerce.boolean().optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type OfferInput = z.infer<typeof offerInputSchema>;
