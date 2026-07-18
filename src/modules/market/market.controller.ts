import type { Request, Response } from 'express';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import {
  listOpportunitiesQuerySchema,
  scanMarketSchema,
  updateOpportunitySchema,
} from './market.schema.js';
import { marketService } from './market.service.js';

export const marketController = {
  /** POST /api/market/scan — déclenche une analyse de marché. */
  async scan(req: Request, res: Response) {
    const input = parseBody(scanMarketSchema, req);
    const result = await marketService.scan(input);
    res.json({ message: 'Analyse de marché terminée', ...result });
  },

  async list(req: Request, res: Response) {
    const query = parseQuery(listOpportunitiesQuerySchema, req);
    res.json(await marketService.list(query));
  },

  async get(req: Request, res: Response) {
    res.json(await marketService.getById(req.params.id));
  },

  async update(req: Request, res: Response) {
    const { status } = parseBody(updateOpportunitySchema, req);
    res.json(await marketService.setStatus(req.params.id, status));
  },
};
