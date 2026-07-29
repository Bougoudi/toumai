import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { discoveryService } from './discovery.service.js';

const photoSchema = z.object({
  hint: z.string().optional(),
  /** Image en data URL / base64 (≈ 900 Ko max une fois encodée). */
  image: z.string().max(900_000).optional(),
});

const favoriteSchema = z.object({
  source: z.string().optional(),
  title: z.string().min(1),
  category: z.string().optional(),
  keywords: z.string().optional(),
  price: z.number().positive().optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
});

export const discoveryController = {
  searchText(req: Request, res: Response) {
    res.json({ results: discoveryService.searchText(String(req.query.q ?? '')) });
  },
  async searchPhoto(req: Request, res: Response) {
    const input = parseBody(photoSchema, req);
    res.json(await discoveryService.searchPhoto(input));
  },
  async searchBarcode(req: Request, res: Response) {
    res.json(await discoveryService.searchBarcode(String(req.params.code)));
  },

  listFavorites(_req: Request, res: Response) {
    return discoveryService.listFavorites().then((r) => res.json(r));
  },
  addFavorite(req: Request, res: Response) {
    return discoveryService.addFavorite(parseBody(favoriteSchema, req)).then((r) => res.status(201).json(r));
  },
  async removeFavorite(req: Request, res: Response) {
    await discoveryService.removeFavorite(req.params.id);
    res.status(204).send();
  },
  async source(req: Request, res: Response) {
    res.json(await discoveryService.sourceFavorite(req.params.id));
  },
  async publish(req: Request, res: Response) {
    res.json(await discoveryService.publishFavorite(req.params.id, req.params.channelId));
  },
};
