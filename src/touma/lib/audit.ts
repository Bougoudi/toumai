import type { Request } from 'express';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Journal d'audit : trace les actions sensibles (décisions admin, vérifications,
 * litiges, changements de statut, paiements). Ne doit **jamais** contenir de
 * secret, jeton, mot de passe ou donnée bancaire.
 */
export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Écrit une entrée d'audit. Une panne d'audit ne doit pas casser l'action métier. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.toumaAuditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? {}) as object,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error('Écriture du journal d’audit impossible', {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Raccourci : audit à partir d'une requête Express (acteur + IP). */
export async function auditRequest(
  req: Request,
  action: string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit({ actorId: req.toumaUser?.id ?? null, action, entity, entityId, metadata, ip: req.ip ?? null });
}
