import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/** Utilisateur Touma authentifié, attaché à la requête. */
export interface ToumaRequestUser {
  id: string;
  email: string;
  role: string;
  status: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par `authenticate` / `optionalAuth` (place de marché Touma). */
      toumaUser?: ToumaRequestUser;
    }
  }
}

function bearer(req: Request): string {
  const header = req.header('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function resolveUser(token: string): Promise<ToumaRequestUser | null> {
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, toumaRole: true, status: true, tokenVersion: true },
  });
  // Un « déconnexion partout » (tokenVersion++) invalide immédiatement le jeton.
  if (!user || user.tokenVersion !== payload.tv) return null;
  if (user.status !== 'ACTIVE') return null;
  return { id: user.id, email: user.email, role: user.toumaRole, status: user.status };
}

/** Exige un jeton d'accès valide. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const user = await resolveUser(token);
    if (!user) throw unauthorized('Session invalide ou expirée.');
    req.toumaUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attache l'utilisateur s'il est authentifié, sans jamais rejeter la requête. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (token) {
      const user = await resolveUser(token);
      if (user) req.toumaUser = user;
    }
  } catch {
    // ignoré : route publique
  }
  next();
}

/** Contrôle d'accès par rôle (RBAC). À composer après `authenticate`. */
export function requireRole(...roles: Array<'BUYER' | 'SELLER' | 'ADMIN'>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.toumaUser) return next(unauthorized());
    // L'administrateur a accès à tout ce qui est explicitement listé pour lui.
    if (!roles.includes(req.toumaUser.role as 'BUYER' | 'SELLER' | 'ADMIN')) {
      return next(forbidden("Votre rôle ne permet pas d'effectuer cette action."));
    }
    next();
  };
}

/** Raccourci : administrateur uniquement. */
export const requireAdmin = requireRole('ADMIN');

/** Utilisateur courant (lève 401 si absent) — évite les `!` dans les services. */
export function currentUser(req: Request): ToumaRequestUser {
  if (!req.toumaUser) throw unauthorized();
  return req.toumaUser;
}
