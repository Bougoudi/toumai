import { z } from 'zod';

export const connectChannelSchema = z.object({
  type: z.enum(['etsy', 'ebay', 'amazon']),
  name: z.string().min(1, 'Le nom est requis'),
  config: z.record(z.string()).default({}),
});

export const updateChannelSchema = z.object({
  config: z.record(z.string()).default({}),
});

export type ConnectChannelInput = z.infer<typeof connectChannelSchema>;
