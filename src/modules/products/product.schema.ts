import { z } from 'zod';

export const createProductSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1, 'Le nom est requis'),
  description: z.string().optional(),
  category: z.string().min(1, 'La catégorie est requise'),
  keywords: z.string().default(''),
  targetUnitPrice: z.number().positive().optional(),
  targetQuantity: z.number().int().positive().optional(),
  currency: z.string().default('EUR'),
  region: z.string().optional(),
  requiredCertifications: z.string().default(''),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsQuerySchema = z.object({
  category: z.string().optional(),
  q: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
