import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { verifyStepUp, verifyToken, type TokenPayload } from '../utils/auth.js';

/** Étend Request avec l'utilisateur authentifié. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware d'authentification : exige un jeton Bearer valide et non révoqué.
 * Vérifie la version de session (`tv`) contre la base — un « déconnexion partout »
 * incrémente cette version et invalide tous les jetons émis avant.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { tokenVersion: true } });
    if (!user || user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
    }
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware « step-up » : exige une ré-authentification récente (en-tête
 * `x-step-up`) pour les actions sensibles.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-step-up') ?? '';
  const userId = token ? verifyStepUp(token) : null;
  if (!userId || userId !== req.user?.sub) {
    return res.status(403).json({ error: 'Ré-authentification requise pour cette action sensible.' });
  }
  next();
}
