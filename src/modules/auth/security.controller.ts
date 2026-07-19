import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { securityService } from './security.service.js';

/** Métadonnées de requête pour le journal. */
export function reqMeta(req: Request) {
  return { ip: req.ip, userAgent: (req.header('user-agent') ?? '').slice(0, 200) };
}

const stepUpSchema = z.object({
  method: z.enum(['password', 'totp']),
  value: z.string().min(1),
});

export const securityController = {
  async history(req: Request, res: Response) {
    res.json(await securityService.history(req.user!.sub));
  },

  async logoutAll(req: Request, res: Response) {
    res.json(await securityService.logoutEverywhere(req.user!.sub));
  },

  async stepUp(req: Request, res: Response) {
    const { method, value } = parseBody(stepUpSchema, req);
    res.json(await securityService.stepUp(req.user!.sub, method, value));
  },

  async deleteAccount(req: Request, res: Response) {
    await securityService.deleteAccount(req.user!.sub);
    res.status(204).send();
  },

  async policy(req: Request, res: Response) {
    res.json(await securityService.mfaPolicy(req.user!.sub));
  },
};
