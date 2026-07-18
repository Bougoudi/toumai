import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { adService } from './ad.service.js';

const generateSchema = z.object({
  productId: z.string().min(1),
  platform: z.enum(['meta', 'google', 'ebay', 'tiktok']).default('meta'),
  budget: z.number().nonnegative().optional(),
});
const statusSchema = z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']) });

export const adController = {
  list(req: Request, res: Response) {
    return adService.list(req.query.productId ? String(req.query.productId) : undefined).then((r) => res.json(r));
  },
  generate(req: Request, res: Response) {
    return adService.generate(parseBody(generateSchema, req)).then((r) => res.status(201).json(r));
  },
  setStatus(req: Request, res: Response) {
    const { status } = parseBody(statusSchema, req);
    return adService.setStatus(req.params.id, status).then((r) => res.json(r));
  },
  async remove(req: Request, res: Response) {
    await adService.remove(req.params.id);
    res.status(204).send();
  },
};
