import { HttpError } from '../../middleware/errorHandler.js';

/**
 * Limitation de débit par action et par utilisateur (fenêtre glissante).
 *
 * Le limiteur global d'API protège l'infrastructure ; celui-ci protège les
 * **personnes** : on n'inonde pas un fournisseur de messages, on n'ouvre pas
 * cent conversations à la minute.
 *
 * Implémentation en mémoire, volontairement : ce dépôt n'a pas de client Redis
 * et en ajouter un pour cela seul serait une dépendance de plus à exploiter.
 * Sur plusieurs instances, remplacer `hits` par un compteur Redis suffit — la
 * signature ne change pas.
 */

interface Window {
  /** Horodatages des occurrences encore dans la fenêtre. */
  at: number[];
}

const buckets = new Map<string, Window>();

export interface ThrottleRule {
  /** Nom de l'action, utilisé comme préfixe de clé. */
  action: string;
  /** Occurrences autorisées dans la fenêtre. */
  limit: number;
  /** Largeur de la fenêtre, en secondes. */
  windowSeconds: number;
  /** Message renvoyé lorsque la limite est atteinte. */
  message: string;
}

/** 429 — trop de requêtes. */
export class TooManyRequests extends HttpError {
  constructor(message: string, public readonly retryAfterSeconds: number) {
    super(429, message);
  }
}

/**
 * Consomme un jeton. Lève `TooManyRequests` (429) si la limite est dépassée.
 * L'appel ne consomme rien lorsqu'il échoue : un utilisateur bloqué ne
 * s'enfonce pas davantage à chaque tentative.
 */
export function consume(subjectId: string, rule: ThrottleRule): void {
  const key = `${rule.action}:${subjectId}`;
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const bucket = buckets.get(key) ?? { at: [] };
  bucket.at = bucket.at.filter((t) => now - t < windowMs);

  if (bucket.at.length >= rule.limit) {
    buckets.set(key, bucket);
    const oldest = bucket.at[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    throw new TooManyRequests(rule.message, retryAfter);
  }

  bucket.at.push(now);
  buckets.set(key, bucket);
}

/** Occurrences déjà consommées dans la fenêtre (diagnostic, tests). */
export function used(subjectId: string, rule: ThrottleRule): number {
  const bucket = buckets.get(`${rule.action}:${subjectId}`);
  if (!bucket) return 0;
  const now = Date.now();
  return bucket.at.filter((t) => now - t < rule.windowSeconds * 1000).length;
}

/** Réservé aux tests : remet les compteurs à zéro. */
export function resetThrottles(): void {
  buckets.clear();
}

/** Règles de la messagerie. Ajustables sans toucher au métier. */
export const MESSAGING_RULES = {
  message: {
    action: 'msg.send',
    limit: Number(process.env.TOUMA_MSG_PER_MINUTE ?? 20),
    windowSeconds: 60,
    message: 'Vous envoyez trop de messages. Patientez une minute.',
  },
  conversation: {
    action: 'msg.conversation',
    limit: Number(process.env.TOUMA_CONVERSATIONS_PER_HOUR ?? 30),
    windowSeconds: 3600,
    message: 'Trop de conversations ouvertes en une heure. Réessayez plus tard.',
  },
  upload: {
    action: 'msg.upload',
    limit: Number(process.env.TOUMA_UPLOADS_PER_MINUTE ?? 10),
    windowSeconds: 60,
    message: 'Trop de fichiers envoyés. Patientez une minute.',
  },
  offer: {
    action: 'msg.offer',
    limit: Number(process.env.TOUMA_OFFERS_PER_MINUTE ?? 10),
    windowSeconds: 60,
    message: 'Trop de propositions envoyées coup sur coup. Patientez une minute.',
  },
} satisfies Record<string, ThrottleRule>;
