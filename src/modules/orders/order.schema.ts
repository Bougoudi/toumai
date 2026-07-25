import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  zip: z.string().optional(),
});

const orderItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
});

/** Un client peut être fourni par id, ou créé à la volée. */
export const createOrderSchema = z
  .object({
    customerId: z.string().optional(),
    customer: createCustomerSchema.optional(),
    items: z.array(orderItemInputSchema).min(1, 'Au moins un article requis'),
    /** Marque la commande comme payée immédiatement (déclenche l'exécution auto). */
    markPaid: z.boolean().default(true),
  })
  .refine((v) => v.customerId || v.customer, {
    message: 'Fournir customerId ou les informations client.',
  });

export const listOrdersQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
    .optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
