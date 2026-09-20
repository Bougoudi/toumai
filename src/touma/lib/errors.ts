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
/** 429 — trop de requêtes (plafond d'usage, pas seulement limiteur HTTP). */
export const tooManyRequests = (message: string) => new HttpError(429, message);
/**
 * 503 — fonction momentanément indisponible.
 *
 * Distinct de 403 : l'utilisateur a le droit, c'est le service qui ne répond
 * pas. Un coupe-circuit baissé rend 503, jamais 500 — une fonctionnalité
 * volontairement éteinte n'est pas une panne, et la confondre avec une panne
 * ferait chercher un incident là où il n'y en a pas.
 */
export const serviceUnavailable = (message: string) => new HttpError(503, message);

export { HttpError };
