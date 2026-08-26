import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { setAliexpressCreds, setAiCreds } from './settings.service.js';
import { settingsService } from './settings.service.js';

const aiSchema = z.object({
  provider: z.enum(['gemini', 'openai', 'anthropic']).optional(),
  apiKey: z.string().min(1).max(300).optional(),
  model: z.string().max(80).optional(),
});

const aliexpressSchema = z.object({
  appKey: z.string().min(1).max(64).optional(),
  appSecret: z.string().min(1).max(200).optional(),
  trackingId: z.string().max(64).optional(),
  feedName: z.string().max(128).optional(),
});

const updateSchema = z.object({
  defaultMarkup: z.number().min(1).max(20).optional(),
  minOpportunityScore: z.number().min(0).max(100).optional(),
  productsPerRun: z.number().int().min(1).max(1000).optional(),
  currency: z.string().min(1).max(8).optional(),
  autopilotIntervalSeconds: z.number().int().min(10).max(3600).optional(),
  simulateDemand: z.boolean().optional(),
  ordersPerCycle: z.number().int().min(0).max(50).optional(),
});

export const settingsController = {
  get(_req: Request, res: Response) {
    res.json(settingsService.get());
  },
  async update(req: Request, res: Response) {
    const patch = parseBody(updateSchema, req);
    res.json(await settingsService.update(patch));
  },
  async reset(_req: Request, res: Response) {
    res.json(await settingsService.reset());
  },
  /** POST /api/settings/purge — supprime les données de démonstration (garde le compte). */
  async purge(_req: Request, res: Response) {
    res.json(await settingsService.purgeBusinessData());
  },

  /** POST /api/settings/aliexpress — enregistre les clés de recherche AliExpress. */
  async aliexpress(req: Request, res: Response) {
    const input = parseBody(aliexpressSchema, req);
    res.json(await setAliexpressCreds(input));
  },

  /** POST /api/settings/ai — enregistre la clé de l'assistant IA (service client). */
  async ai(req: Request, res: Response) {
    const input = parseBody(aiSchema, req);
    res.json(await setAiCreds(input));
  },
};
