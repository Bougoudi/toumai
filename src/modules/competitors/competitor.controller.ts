import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import { competitorService } from './competitor.service.js';

const addSchema = z.object({
  platform: z.enum(['ebay', 'etsy', 'amazon']).default('ebay'),
  shopName: z.string().min(1, 'Nom de boutique requis'),
  shopUrl: z.string().url().optional(),
  followed: z.boolean().default(false),
});
const followSchema = z.object({ followed: z.boolean() });
const winningQuery = z.object({
  competitorId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

export const competitorController = {
  async list(_req: Request, res: Response) {
    res.json(await competitorService.list());
  },
  async add(req: Request, res: Response) {
    res.status(201).json(await competitorService.add(parseBody(addSchema, req)));
  },
  async remove(req: Request, res: Response) {
    await competitorService.remove(req.params.id);
    res.status(204).send();
  },
  async follow(req: Request, res: Response) {
    const { followed } = parseBody(followSchema, req);
    res.json(await competitorService.setFollowed(req.params.id, followed));
  },
  async scan(req: Request, res: Response) {
    res.json(await competitorService.scan(req.params.id));
  },
  async winning(req: Request, res: Response) {
    res.json(await competitorService.winningProducts(parseQuery(winningQuery, req)));
  },
  async favorite(req: Request, res: Response) {
    res.status(201).json(await competitorService.favorite(req.params.productId));
  },
};
