import { HttpError } from '../../middleware/errorHandler.js';

/** 400 — requête invalide. */
export const badRequest = (message: string) => new HttpError(400, message);
/** 401 — authentification requise / invalide. */
export const unauthorized = (message = 'Authentification requise.') => new HttpError(401, message);
/** 403 — authentifié mais non autorisé (rôle ou propriété de la ressource). */
export const forbidden = (message = 'Action non autorisée.') => new HttpError(403, message);
/** 404 — ressource inexistante *ou* non accessible (anti-IDOR : même réponse). */
export const notFound = (message = 'Ressource introuvable.') => new HttpError(404, message);
/** 409 — conflit (stock insuffisant, doublon, état incompatible). */
export const conflict = (message: string) => new HttpError(409, message);
/** 422 — règle métier non satisfaite. */
export const unprocessable = (message: string) => new HttpError(422, message);

export { HttpError };
