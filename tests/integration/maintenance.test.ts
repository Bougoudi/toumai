import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { TestApi } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { maintenanceJobs, runMaintenanceOnce } from '../../src/touma/maintenance.js';

/**
 * Entretien périodique du domaine.
 *
 * Les balayages étaient déclenchés par le trafic : cela marche la journée et
 * pas la nuit, or c'est la nuit que les délais expirent. Et deux purges —
 * clés d'idempotence, traces de webhook — étaient écrites, exportées, et
 * **appelées nulle part** : une purge qu'on ne branche pas revient à ne pas
 * l'avoir écrite.
 */
const api = new TestApi();

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});

after(async () => {
  await api.stop();
});

describe('Les purges', () => {
  it('retirent les clés d’idempotence périmées, et gardent les vivantes', async () => {
    const perimee = await prisma.toumaIdempotencyKey.create({
      data: {
        key: `perimee-${Date.now()}`,
        userId: (await prisma.user.findFirstOrThrow({ select: { id: true } })).id,
        operation: 'test.purge',
        requestHash: 'x',
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });
    const vivante = await prisma.toumaIdempotencyKey.create({
      data: {
        key: `vivante-${Date.now()}`,
        userId: perimee.userId,
        operation: 'test.purge',
        requestHash: 'x',
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const supprimees = await maintenanceJobs.idempotency();
    assert.ok(supprimees >= 1);
    assert.equal(await prisma.toumaIdempotencyKey.findUnique({ where: { id: perimee.id } }), null);
    assert.ok(await prisma.toumaIdempotencyKey.findUnique({ where: { id: vivante.id } }), 'une clé encore valable ne se purge pas');

    await prisma.toumaIdempotencyKey.delete({ where: { id: vivante.id } });
  });

  it('retirent les traces de webhook au-delà de la conservation', async () => {
    // La table la plus exposée : un tiers non authentifié la fait grossir.
    const vieille = await prisma.toumaWebhookDelivery.create({
      data: {
        provider: 'mock',
        outcome: 'INVALID_SIGNATURE',
        signatureValid: false,
        bodySha256: createHash('sha256').update(`vieille-${Date.now()}`).digest('hex'),
        bodyBytes: 10,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
      },
    });
    const recente = await prisma.toumaWebhookDelivery.create({
      data: {
        provider: 'mock',
        outcome: 'ACCEPTED',
        signatureValid: true,
        bodySha256: createHash('sha256').update(`recente-${Date.now()}`).digest('hex'),
        bodyBytes: 10,
      },
    });

    const supprimees = await maintenanceJobs.webhooks();
    assert.ok(supprimees >= 1);
    assert.equal(await prisma.toumaWebhookDelivery.findUnique({ where: { id: vieille.id } }), null);
    assert.ok(await prisma.toumaWebhookDelivery.findUnique({ where: { id: recente.id } }), 'une trace récente reste consultable');

    await prisma.toumaWebhookDelivery.delete({ where: { id: recente.id } });
  });
});

describe('Le tour d’entretien complet', () => {
  it('joue les cinq travaux sans dépendre du trafic', async () => {
    // C'est tout l'objet : ces balayages doivent avancer à 3 h du matin, quand
    // personne ne navigue et que les délais expirent.
    await assert.doesNotReject(() => runMaintenanceOnce());
  });

  it('survit à l’échec d’un travail, et n’arrête pas les autres', async () => {
    // Une panne de base pendant une purge ne doit pas empêcher les
    // réservations de revenir au catalogue la minute suivante.
    const original = maintenanceJobs.idempotency;
    (maintenanceJobs as { idempotency: () => Promise<number> }).idempotency = async () => {
      throw new Error('panne simulée');
    };
    try {
      await assert.doesNotReject(() => runMaintenanceOnce(), 'un travail en échec ne doit pas faire remonter l’erreur');
    } finally {
      (maintenanceJobs as { idempotency: () => Promise<number> }).idempotency = original;
    }
  });

  it('est rejouable : deux tours de suite ne cassent rien', async () => {
    // Plusieurs instances peuvent balayer en même temps. Chaque opération est
    // conditionnée à l'état qu'elle corrige, donc la seconde ne trouve
    // simplement rien à faire.
    await runMaintenanceOnce();
    await assert.doesNotReject(() => runMaintenanceOnce());
  });
});
