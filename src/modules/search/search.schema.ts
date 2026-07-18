import { z } from 'zod';

/**
 * Une recherche peut être lancée :
 *  - à partir d'un produit existant (productId), OU
 *  - à partir de critères libres.
 * Les critères explicites priment sur ceux hérités du produit.
 */
export const searchInputSchema = z
  .object({
    productId: z.string().optional(),
    query: z.string().default(''),
    category: z.string().optional(),
    keywords: z.string().default(''),
    targetUnitPrice: z.number().positive().optional(),
    targetQuantity: z.number().int().positive().optional(),
    region: z.string().optional(),
    requiredCertifications: z.string().default(''),
    /** Nombre maximum de fournisseurs retournés. */
    limit: z.number().int().min(1).max(100).default(20),
    /** true → traitement asynchrone via le worker ; false → réponse immédiate. */
    async: z.boolean().default(false),
  })
  .refine((v) => v.productId || v.query || v.category || v.keywords, {
    message: 'Fournir au moins un productId, une requête, une catégorie ou des mots-clés.',
  });

export type SearchInput = z.infer<typeof searchInputSchema>;
