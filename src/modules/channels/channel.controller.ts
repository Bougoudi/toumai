import type { Request, Response } from 'express';
import { parseBody } from '../../middleware/validate.js';
import { connectChannelSchema, updateChannelSchema } from './channel.schema.js';
import { channelService } from './channel.service.js';
import { oauthService } from './oauth.service.js';

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

  /** POST /api/channels/:id/oauth/start — URL d'autorisation OAuth. */
  async oauthStart(req: Request, res: Response) {
    res.json({ ...(await oauthService.start(req.params.id)), redirectUri: oauthService.redirectUri() });
  },

  /** GET /api/oauth/callback — retour d'autorisation de la marketplace (public). */
  async oauthCallback(req: Request, res: Response) {
    const target = await oauthService.callback(req.query as Record<string, string>);
    res.redirect(target);
  },
};
