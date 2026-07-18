import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type TokenPayload } from '../utils/auth.js';

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
 * Middleware d'authentification : exige un jeton Bearer valide.
 * Renvoie 401 si absent, invalide ou expiré.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  req.user = payload;
  next();
}
