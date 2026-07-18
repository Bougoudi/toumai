import { z } from 'zod';

export const scanMarketSchema = z.object({
  category: z.string().optional(),
  region: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const listOpportunitiesQuerySchema = z.object({
  status: z.enum(['NEW', 'EVALUATED', 'IMPORTED', 'REJECTED']).optional(),
  category: z.string().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const updateOpportunitySchema = z.object({
  status: z.enum(['NEW', 'EVALUATED', 'IMPORTED', 'REJECTED']),
});

export type ScanMarketInput = z.infer<typeof scanMarketSchema>;
