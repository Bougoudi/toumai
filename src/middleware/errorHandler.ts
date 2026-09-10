import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

/** Toute erreur portant un `statusCode` est traitée comme une erreur client. */
interface StatusCodeError extends Error {
  statusCode: number;
}

function hasStatusCode(err: unknown): err is StatusCodeError {
  return err instanceof Error && typeof (err as StatusCodeError).statusCode === 'number';
}

/** Erreur applicative avec code HTTP. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** 404 pour toute route non gérée. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Ressource introuvable' });
}

/** Gestionnaire d'erreurs centralisé. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation échouée', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  // Erreurs métier typées portant leur propre code (ex. devises incompatibles).
  if (hasStatusCode(err) && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  logger.error('Erreur non gérée', { err: err instanceof Error ? err.message : String(err) });
  return res.status(500).json({ error: 'Erreur interne du serveur' });
}
