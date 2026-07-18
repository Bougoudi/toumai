import type { Request, Response } from 'express';
import { parseBody } from '../../middleware/validate.js';
import { connectChannelSchema, updateChannelSchema } from './channel.schema.js';
import { channelService } from './channel.service.js';

export const channelController = {
  /** GET /api/channels/types — canaux disponibles + champs de config. */
  types(_req: Request, res: Response) {
    res.json(channelService.types());
  },

  async list(_req: Request, res: Response) {
    res.json(await channelService.list());
  },

  async get(req: Request, res: Response) {
    res.json(await channelService.get(req.params.id));
  },

  /** POST /api/channels — connecte un canal (teste les identifiants). */
  async connect(req: Request, res: Response) {
    const input = parseBody(connectChannelSchema, req);
    res.status(201).json(await channelService.connect(input));
  },

  async update(req: Request, res: Response) {
    const { config } = parseBody(updateChannelSchema, req);
    res.json(await channelService.update(req.params.id, config));
  },

  async test(req: Request, res: Response) {
    res.json(await channelService.test(req.params.id));
  },

  async remove(req: Request, res: Response) {
    await channelService.remove(req.params.id);
    res.status(204).send();
  },

  /** POST /api/channels/:id/publish/:productId — publie un produit en annonce. */
  async publish(req: Request, res: Response) {
    res.json(await channelService.publishProduct(req.params.id, req.params.productId));
  },

  /** POST /api/channels/:id/sync — importe les commandes du canal. */
  async sync(req: Request, res: Response) {
    res.json(await channelService.syncOrders(req.params.id));
  },
};
