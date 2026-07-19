import type { Request, Response } from 'express';
import { parseBody } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { reqMeta } from './security.controller.js';
import { securityService } from './security.service.js';

export const authController = {
  async register(req: Request, res: Response) {
    const input = parseBody(registerSchema, req);
    const result = await authService.register(input);
    await securityService.recordLogin({ userId: result.user.id, method: 'password', ...reqMeta(req) });
    res.status(201).json(result);
  },

  async login(req: Request, res: Response) {
    const input = parseBody(loginSchema, req);
    const result = await authService.login(input);
    // Connexion sans MFA finalisée ici ; sinon le journal est écrit à l'étape 2.
    if ('token' in result && result.user) {
      await securityService.recordLogin({ userId: result.user.id, method: 'password', ...reqMeta(req) });
    }
    res.json(result);
  },

  async me(req: Request, res: Response) {
    const [user, policy] = await Promise.all([
      authService.me(req.user!.sub),
      securityService.mfaPolicy(req.user!.sub),
    ]);
    res.json({ ...user, mfa: policy });
  },
};
