import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseBody } from '../../middleware/validate.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import { authService } from './auth.service.js';
import { reqMeta } from './security.controller.js';
import { securityService } from './security.service.js';

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10, 'Le nouveau mot de passe doit faire au moins 10 caractères.'),
});

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

  /** GET /api/auth/config — indique au front si la réinit par e-mail est possible. */
  config(_req: Request, res: Response) {
    res.json({ emailReset: authService.emailEnabled() });
  },

  /** POST /api/auth/forgot-password — envoie un lien de réinitialisation (public). */
  async forgotPassword(req: Request, res: Response) {
    const { email } = parseBody(forgotSchema, req);
    res.json(await authService.forgotPassword(email));
  },

  /** POST /api/auth/reset-password — applique le nouveau mot de passe (public). */
  async resetPassword(req: Request, res: Response) {
    const { token, newPassword } = parseBody(resetSchema, req);
    const result = await authService.resetPassword(token, newPassword);
    await securityService.recordLogin({ userId: result.user.id, method: 'password-reset', ...reqMeta(req) });
    res.json(result);
  },
};
