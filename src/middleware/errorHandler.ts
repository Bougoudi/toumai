import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { requestIdCourant } from './request-context.js';

/**
 * SYSTÈME D'ERREURS (V25 §20-21).
 *
 * Toute réponse d'erreur porte désormais :
 *
 * ```
 * { error, code, requestId, details? }
 * ```
 *
 * `error` est conservé, et ce n'est pas de la timidité : c'est le champ que
 * lisent l'application web, la vitrine et huit cents tests. Le renommer aurait
 * été un changement cassant sans bénéfice — `code` s'ajoute à côté, pour ce
 * qu'un programme doit décider, pendant qu'`error` reste ce qu'une personne
 * lit.
 *
 * `requestId` est là pour une raison précise : c'est le numéro que quelqu'un
 * cite au support, et le seul moyen de retrouver sa requête dans le journal.
 *
 * Ce qui ne sort jamais en production : pile d'appels, erreur SQL, chemin
 * interne, secret. Un message d'erreur détaillé renseigne autant l'attaquant
 * que l'utilisateur.
 */

/** Toute erreur portant un `statusCode` est traitée comme une erreur client. */
interface StatusCodeError extends Error {
  statusCode: number;
  code?: string;
}

function hasStatusCode(err: unknown): err is StatusCodeError {
  return err instanceof Error && typeof (err as StatusCodeError).statusCode === 'number';
}

/**
 * Code par défaut, déduit du statut HTTP.
 *
 * Un appelant peut toujours en imposer un plus précis (`PAYMENT_PROVIDER_DOWN`,
 * `TRADE_CORRIDOR_CLOSED`…). Ce repli garantit qu'**aucune** réponse d'erreur
 * ne sort sans code, y compris celles écrites avant l'existence des codes.
 */
const CODES_PAR_STATUT: Record<number, string> = {
  400: 'SYSTEM_BAD_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'AUTH_FORBIDDEN',
  404: 'SYSTEM_NOT_FOUND',
  409: 'SYSTEM_CONFLICT',
  422: 'SYSTEM_UNPROCESSABLE',
  429: 'SYSTEM_RATE_LIMITED',
  503: 'SYSTEM_UNAVAILABLE',
};

export function codePourStatut(statusCode: number): string {
  return CODES_PAR_STATUT[statusCode] ?? (statusCode >= 500 ? 'SYSTEM_INTERNAL' : 'SYSTEM_ERROR');
}

/** Erreur applicative avec code HTTP et, si l'appelant le veut, un code métier. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Corps d'erreur normalisé. */
function corps(statusCode: number, message: string, code?: string, details?: unknown) {
  const requestId = requestIdCourant();
  return {
    error: message,
    code: code ?? codePourStatut(statusCode),
    ...(requestId ? { requestId } : {}),
    ...(details === undefined ? {} : { details }),
  };
}

/** 404 pour toute route non gérée. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json(corps(404, 'Ressource introuvable'));
}

/** Gestionnaire d'erreurs centralisé. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json(corps(400, 'Validation échouée', 'SYSTEM_VALIDATION', err.flatten()));
  }
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json(corps(err.statusCode, err.message, err.code));
  }
  // Erreurs métier typées portant leur propre code (ex. devises incompatibles).
  if (hasStatusCode(err) && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json(corps(err.statusCode, err.message, err.code));
  }

  /**
   * Erreur non gérée.
   *
   * Le détail va dans le journal, avec l'identifiant de requête ; l'appelant
   * ne reçoit que cet identifiant. C'est ce qui permet à quelqu'un de dire
   * « erreur ab12… » sans que le message d'erreur ait eu à révéler la
   * structure de la base ou un chemin de fichier.
   */
  logger.error('Erreur non gérée', {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return res.status(500).json(corps(500, 'Erreur interne du serveur'));
}
