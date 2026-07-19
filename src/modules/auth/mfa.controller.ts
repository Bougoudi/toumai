import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { parseBody } from '../../middleware/validate.js';
import { verifyMfaChallenge } from '../../utils/auth.js';
import { authService } from './auth.service.js';
import { mfaService } from './mfa.service.js';
import { reqMeta } from './security.controller.js';
import { securityService } from './security.service.js';

/** Résout l'id utilisateur depuis un jeton de défi MFA (étape 2 de connexion). */
function requireMfaToken(req: Request): string {
  const token = String(req.body?.mfaToken ?? '');
  const userId = verifyMfaChallenge(token);
  if (!userId) throw new HttpError(401, 'Défi expiré, reconnectez-vous.');
  return userId;
}

export const mfaController = {
  // ── Enrôlement (session complète requise) ──────────────
  async status(req: Request, res: Response) {
    res.json(await mfaService.status(req.user!.sub));
  },
  async totpSetup(req: Request, res: Response) {
    res.json(await mfaService.totpSetup(req.user!.sub));
  },
  async totpEnable(req: Request, res: Response) {
    const { code } = parseBody(z.object({ code: z.string().min(6).max(8) }), req);
    res.json(await mfaService.totpEnable(req.user!.sub, code));
  },
  async totpDisable(req: Request, res: Response) {
    res.json(await mfaService.totpDisable(req.user!.sub));
  },
  async regenerateRecovery(req: Request, res: Response) {
    res.json(await mfaService.regenerateRecovery(req.user!.sub));
  },
  async webauthnRegisterOptions(req: Request, res: Response) {
    res.json(await mfaService.webauthnRegisterOptions(req.user!.sub));
  },
  async webauthnRegisterVerify(req: Request, res: Response) {
    const { response, name } = parseBody(z.object({ response: z.any(), name: z.string().optional() }), req);
    res.json(await mfaService.webauthnRegisterVerify(req.user!.sub, response, name));
  },
  async removeKey(req: Request, res: Response) {
    await mfaService.removeSecurityKey(req.user!.sub, req.params.id);
    res.status(204).send();
  },

  // ── Étape 2 de connexion (jeton de défi MFA) ───────────
  async verify(req: Request, res: Response) {
    const userId = requireMfaToken(req);
    const { method, code } = parseBody(
      z.object({ mfaToken: z.string(), method: z.enum(['totp', 'recovery']), code: z.string().min(6) }),
      req,
    );
    let ok = false;
    if (method === 'totp') {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      ok = user?.totpEnabled ? mfaService.verifyTotpCode(user.totpSecret, code) : false;
    } else {
      ok = await mfaService.consumeRecoveryCode(userId, code);
    }
    if (!ok) throw new HttpError(401, 'Code incorrect.');
    await securityService.recordLogin({ userId, method, ...reqMeta(req) });
    res.json(await authService.issueSession(userId));
  },
  async webauthnAuthOptions(req: Request, res: Response) {
    const userId = requireMfaToken(req);
    res.json(await mfaService.webauthnAuthOptions(userId));
  },
  async webauthnAuthVerify(req: Request, res: Response) {
    const userId = requireMfaToken(req);
    const { response } = parseBody(z.object({ mfaToken: z.string(), response: z.any() }), req);
    const ok = await mfaService.webauthnAuthVerify(userId, response);
    if (!ok) throw new HttpError(401, 'Vérification de la clé échouée.');
    await securityService.recordLogin({ userId, method: 'webauthn', ...reqMeta(req) });
    res.json(await authService.issueSession(userId));
  },
};
