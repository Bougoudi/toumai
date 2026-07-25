import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody, parseQuery } from '../../middleware/validate.js';
import { searchInputSchema } from './search.schema.js';
import { searchService } from './search.service.js';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export const searchController = {
  /** POST /api/search — lance une recherche (synchrone ou file d'attente). */
  async search(req: Request, res: Response) {
    const input = parseBody(searchInputSchema, req);
    if (input.async) {
      const request = await searchService.queueRequest(input);
      return res.status(202).json({
        message: 'Recherche mise en file. Interrogez /api/search/:id pour les résultats.',
        request,
      });
    }
    const result = await searchService.searchNow(input);
    res.json(result);
  },

  async get(req: Request, res: Response) {
    res.json(await searchService.getRequest(req.params.id));
  },

  async list(req: Request, res: Response) {
    const query = parseQuery(listQuerySchema, req);
    res.json(await searchService.listRequests(query));
  },
};
