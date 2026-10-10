import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { conflict } from './errors.js';
import { currentUser } from '../middleware/toumaAuth.js';

/**
 * Idempotence des opérations financières.
 *
 * **Pourquoi.** Au Tchad, un réseau qui coupe entre l'envoi et la réponse est la
 * situation normale, pas l'exception : l'acheteur renvoie, le navigateur rejoue,
 * l'application réessaie. Sans clé, la seconde requête est une opération de
 * plus — un second remboursement, un second versement, une seconde commande.
 *
 * **Ce que cette couche fait, et qu'un simple verrou ne fait pas.** La requête
 * rejouée reçoit **la réponse d'origine**, pas une erreur. Un client qui
 * redemande poliment la même chose doit obtenir la même réponse ; sinon il
 * redemande encore, et c'est ainsi qu'on finit par créer trois remboursements
 * pour un seul geste commercial.
 *
 * **Trois cas, trois réponses :**
 *
 * - même clé, même corps, opération terminée → la réponse d'origine, rejouée ;
 * - même clé, même corps, opération **en cours** → 409, parce que deux
 *   exécutions simultanées de la même opération financière ne doivent jamais
 *   coexister ;
 * - même clé, **corps différent** → 409 : le client s'est trompé de clé, et le
 *   lui dire vaut mieux que de lui servir la réponse d'une autre opération.
 *
 * Ce qui est stocké est le corps que l'API a réellement rendu. Aucun secret n'y
 * transite — c'est déjà ce que le client a reçu.
 */

/** Durée de vie d'une clé. Au-delà, la table deviendrait un journal. */
const TTL_HOURS = Number(process.env.TOUMA_IDEMPOTENCY_TTL_HOURS ?? 24);

/** Empreinte stable du corps : l'ordre des clés JSON ne doit pas compter. */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Middleware d'idempotence pour une opération donnée.
 *
 * Sans en-tête `Idempotency-Key`, la requête passe sans filet : on ne refuse pas
 * une opération parce que le client n'a pas fourni de clé — beaucoup de clients
 * anciens n'en envoient pas — mais chaque route protégée doit conserver ses
 * propres garde-fous métier. L'idempotence est une ceinture, pas le seul appui.
 */
export function idempotent(operation: string) {
  return function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = req.header('idempotency-key')?.trim();
    if (!key) {
      next();
      return;
    }
    if (key.length < 8 || key.length > 200) {
      next(conflict('La clé d’idempotence doit compter entre 8 et 200 caractères.'));
      return;
    }

    void run(operation, key, req, res, next);
  };
}

async function run(operation: string, key: string, req: Request, res: Response, next: NextFunction): Promise<void> {
  let userId: string;
  try {
    userId = currentUser(req).id;
  } catch {
    // Route non authentifiée : rien à porter la clé. On laisse passer plutôt
    // que d'inventer un propriétaire.
    next();
    return;
  }

  const requestHash = requestFingerprint(req.body ?? {});
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);

  let claimed = false;
  try {
    await prisma.toumaIdempotencyKey.create({
      data: { key, userId, operation, requestHash, status: 'IN_PROGRESS', expiresAt },
    });
    claimed = true;
  } catch (err) {
    // Conflit d'unicité : quelqu'un — souvent le même client — est déjà passé.
    if ((err as { code?: string }).code !== 'P2002') {
      next(err as Error);
      return;
    }
  }

  if (!claimed) {
    const existing = await prisma.toumaIdempotencyKey.findUnique({
      where: { userId_operation_key: { userId, operation, key } },
    });
    // Disparue entre-temps (expiration, nettoyage) : on laisse la requête vivre
    // sa vie plutôt que de la bloquer sur un fantôme.
    if (!existing) {
      next();
      return;
    }

    if (existing.requestHash !== requestHash) {
      next(conflict('Cette clé d’idempotence a déjà servi pour une requête différente.'));
      return;
    }
    if (existing.status === 'IN_PROGRESS') {
      next(conflict('Une requête portant cette clé est déjà en cours.'));
      return;
    }
    if (existing.status === 'COMPLETED' && existing.responseStatus) {
      // Le point de toute cette mécanique : la réponse d'origine, à l'identique.
      res.setHeader('idempotent-replay', 'true');
      res.status(existing.responseStatus).json(existing.responseBody ?? {});
      return;
    }
    // Échec précédent : la clé est libérée, on réessaie réellement.
    await prisma.toumaIdempotencyKey.update({
      where: { id: existing.id },
      data: { status: 'IN_PROGRESS', requestHash, expiresAt },
    });
  }

  // On intercepte la réponse pour la conserver. `res.json` est le seul chemin de
  // sortie des routes Touma ; un envoi par un autre moyen ne serait pas rejoué,
  // et c'est préférable à enregistrer un corps qu'on n'a pas compris.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const status = res.statusCode;
    const finished = status >= 200 && status < 300;

    // **La réponse part après l'écriture, jamais avant.** Une mise à jour lancée
    // sans être attendue laisse une fenêtre pendant laquelle la clé est encore
    // « en cours » : un client qui renvoie aussitôt — ce que fait tout client
    // sur réseau instable — passe au travers, et c'est précisément ce que cette
    // couche existe pour empêcher. Le coût est une écriture avant l'envoi, sur
    // les seules routes qui déplacent de l'argent.
    void (async () => {
      try {
        await prisma.toumaIdempotencyKey.update({
          where: { userId_operation_key: { userId, operation, key } },
          data: finished
            ? { status: 'COMPLETED', responseStatus: status, responseBody: (body ?? {}) as Prisma.InputJsonValue }
            : { status: 'FAILED' },
        });
      } catch (err) {
        // On n'empêche pas la réponse de partir pour autant : l'opération a eu
        // lieu, et le client doit l'apprendre. La perte porte sur le rejeu.
        logger.error('Clé d’idempotence non mise à jour', { operation, err: err instanceof Error ? err.message : String(err) });
      }
      originalJson(body);
    })();

    return res;
  };

  next();
}

/**
 * Purge des clés expirées.
 *
 * Une table d'idempotence qu'on ne purge jamais devient un journal, et un
 * journal qu'on n'a pas voulu : elle grossit à chaque requête qui touche à
 * l'argent.
 *
 * Le commentaire précédent affirmait qu'elle était « appelée par le balayage
 * opportuniste ». Elle ne l'était par personne. Elle est maintenant branchée
 * sur l'entretien périodique (`src/touma/maintenance.ts`).
 */
export async function purgeExpiredKeys(now = new Date()): Promise<number> {
  const { count } = await prisma.toumaIdempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  if (count > 0) logger.info('Clés d’idempotence expirées purgées', { count });
  return count;
}
