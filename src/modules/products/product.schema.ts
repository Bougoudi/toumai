import { z } from 'zod';

export const createProductSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1, 'Le nom est requis'),
  description: z.string().optional(),
  category: z.string().min(1, 'La catégorie est requise'),
  keywords: z.string().default(''),
  currency: z.string().default('EUR'),
  costPrice: z.number().positive().optional(),
  salePrice: z.number().positive().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  source: z.string().default('manual'),
  images: z.string().default(''),
  // Critères de sourcing (pilier 4)
  targetUnitPrice: z.number().positive().optional(),
  targetQuantity: z.number().int().positive().optional(),
  region: z.string().optional(),
  requiredCertifications: z.string().default(''),
  opportunityId: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsQuerySchema = z.object({
  category: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  q: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

/** Génération de produits en masse à partir des opportunités marché (pilier 2). */
export const generateProductsSchema = z.object({
  /** Nombre de produits à générer. */
  limit: z.number().int().min(1).max(1000).default(50),
  /** Score d'opportunité minimum requis. */
  minScore: z.number().min(0).max(100).optional(),
  category: z.string().optional(),
  /** Publie directement les produits générés (status ACTIVE) au lieu de DRAFT. */
  autoPublish: z.boolean().default(false),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type GenerateProductsInput = z.infer<typeof generateProductsSchema>;
