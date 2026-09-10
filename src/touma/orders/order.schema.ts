import { z } from 'zod';

export const checkoutSchema = z.object({
  /** Adresse de livraison de l'acheteur (doit lui appartenir). */
  addressId: z.string().cuid(),
  /** Devis de transport choisis, par boutique : { storeId: quoteId }. */
  shippingQuotes: z.record(z.string().cuid()).optional(),
  note: z.string().trim().max(1000).optional(),
  /** Clé d'idempotence : rejouer la même requête ne crée pas deux commandes. */
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const listOrdersSchema = z.object({
  /** `buyer` (mes achats) ou `seller` (les commandes de mes boutiques). */
  scope: z.enum(['buyer', 'seller']).default('buyer'),
  status: z
    .enum(['PENDING', 'PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED'])
    .optional(),
  storeId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED']),
  reason: z.string().trim().max(500).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;
