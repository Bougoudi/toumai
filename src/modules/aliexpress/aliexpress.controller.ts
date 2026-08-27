import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { aliexpressOAuthService } from './aliexpress.oauth.service.js';
import { getProductConnector } from '../../automation/connectors/registry.js';
import { AliExpressProductConnector } from '../../automation/connectors/product/aliexpress.product.connector.js';

export const aliexpressController = {
  /** GET /api/aliexpress/oauth/start — URL d'autorisation à ouvrir. */
  async start(_req: Request, res: Response) {
    res.json(await aliexpressOAuthService.authorizeUrl());
  },

  /** GET /api/aliexpress/status — état de la connexion. */
  async status(_req: Request, res: Response) {
    res.json(await aliexpressOAuthService.status());
  },

  /**
   * GET /api/aliexpress/diag?q=... — diagnostic de la recherche par mot-clé :
   * essaie plusieurs conventions d'appel et renvoie l'erreur exacte de chacune.
   */
  async diag(req: Request, res: Response) {
    const connector = await getProductConnector();
    if (!connector || !(connector instanceof AliExpressProductConnector)) {
      return res.json({ error: 'Connecteur AliExpress non configuré.' });
    }
    const q = String(req.query.q || 'watch');
    res.json({ query: q, variants: await connector.diagnoseTextSearch(q) });
  },

  /**
   * GET /api/aliexpress/oauth/callback — PUBLIC (AliExpress redirige le
   * navigateur). Échange le code, puis renvoie l'utilisateur vers l'app.
   */
  async callback(req: Request, res: Response) {
    const base = env.publicUrl.replace(/\/$/, '');
    try {
      await aliexpressOAuthService.handleCallback(req.query as Record<string, string>);
      res.redirect(`${base}/?aliexpress=connected`);
    } catch (e) {
      const msg = encodeURIComponent(String((e as Error).message || 'erreur').slice(0, 160));
      res.redirect(`${base}/?aliexpress=error&msg=${msg}`);
    }
  },
};
