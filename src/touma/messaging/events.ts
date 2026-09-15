import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { logger } from '../../utils/logger.js';

/**
 * Temps réel TOUMA — diffusion d'événements de messagerie.
 *
 * Le prompt V14 demande une passerelle WebSocket. Ce dépôt sert l'API derrière
 * Express, sans dépendance temps réel, et la règle du projet est qu'aucune
 * fonctionnalité ne doit **dépendre** du temps réel : REST reste la source de
 * vérité. On utilise donc un flux d'événements serveur (SSE) :
 *
 * - il passe partout où passe HTTP (proxys, load balancers, pare-feu
 *   d'entreprise, réseaux mobiles africains qui coupent souvent WebSocket) ;
 * - il ne demande aucune bibliothèque supplémentaire ;
 * - il se reconnecte tout seul côté navigateur ;
 * - s'il est indisponible, l'interface continue de fonctionner en REST.
 *
 * Le bus est **en mémoire** : correct pour un processus unique. Le jour où
 * TOUMA tourne sur plusieurs instances, ce fichier est le seul point à
 * remplacer par un bus partagé (Redis pub/sub), sans toucher au métier.
 */

export type MessagingEventName =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'message.read'
  | 'conversation.updated'
  | 'offer.created'
  | 'offer.accepted'
  | 'offer.rejected'
  | 'typing.start'
  | 'typing.stop';

export interface MessagingEvent {
  name: MessagingEventName;
  /** Destinataires : un événement n'est jamais diffusé hors des participants. */
  userIds: string[];
  conversationId?: string;
  payload: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Abonnements ouverts, par utilisateur. */
const subscribers = new Map<string, Set<Response>>();

/** Publie un événement aux seuls participants concernés. */
export function publish(event: MessagingEvent): void {
  const seen = new Set<string>();
  for (const userId of event.userIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    const connections = subscribers.get(userId);
    if (!connections?.size) continue;
    const frame = `event: ${event.name}\ndata: ${JSON.stringify({
      name: event.name,
      conversationId: event.conversationId ?? null,
      ...event.payload,
    })}\n\n`;
    for (const res of connections) {
      try {
        res.write(frame);
      } catch (err) {
        logger.warn('Flux d’événements interrompu', { err: err instanceof Error ? err.message : String(err) });
        connections.delete(res);
      }
    }
  }
  bus.emit(event.name, event);
}

/**
 * Attache une réponse Express au flux d'un utilisateur. Renvoie la fonction de
 * détachement (à appeler à la fermeture de la connexion).
 */
export function subscribe(userId: string, res: Response): () => void {
  const connections = subscribers.get(userId) ?? new Set<Response>();
  connections.add(res);
  subscribers.set(userId, connections);
  return () => {
    connections.delete(res);
    if (connections.size === 0) subscribers.delete(userId);
  };
}

/** Nombre de connexions ouvertes pour un utilisateur (présence approximative). */
export function connectionCount(userId: string): number {
  return subscribers.get(userId)?.size ?? 0;
}

/**
 * Présence : un utilisateur est « en ligne » s'il a un flux ouvert. Rien n'est
 * stocké en base — une présence inventée serait pire que pas de présence.
 */
export function presence(userId: string): 'ONLINE' | 'OFFLINE' {
  return connectionCount(userId) > 0 ? 'ONLINE' : 'OFFLINE';
}

/** Réservé aux tests : coupe tous les flux ouverts. */
export function closeAllStreams(): void {
  for (const connections of subscribers.values()) {
    for (const res of connections) {
      try {
        res.end();
      } catch {
        /* la connexion était déjà fermée */
      }
    }
  }
  subscribers.clear();
}
