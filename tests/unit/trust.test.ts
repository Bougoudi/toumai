import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { computePriority, deadlineFrom, RESPONSE_HOURS } from '../../src/touma/disputes/escalation.js';

describe('Priorité d’un litige', () => {
  const base = { amount: 50_000, category: 'DAMAGED_ITEM', previousDisputesOnStore: 0 };

  it('met la fraude devant tout le reste', () => {
    // Une fraude peut concerner d'autres acheteurs que celui qui signale.
    assert.equal(computePriority({ ...base, category: 'FRAUD' }), 'CRITICAL');
    assert.equal(computePriority({ ...base, category: 'FRAUD', amount: 1 }), 'CRITICAL');
  });

  it('remonte les gros montants et les boutiques qui accumulent', () => {
    assert.equal(computePriority({ ...base, amount: 900_000 }), 'HIGH');
    assert.equal(computePriority({ ...base, previousDisputesOnStore: 3 }), 'HIGH');
  });

  it('traite un colis jamais reçu comme urgent', () => {
    // De l'argent est immobilisé des deux côtés tant que personne ne sait où
    // est le colis.
    assert.equal(computePriority({ ...base, category: 'NON_DELIVERY', amount: 1000 }), 'HIGH');
  });

  it('laisse les petits litiges en bas de pile', () => {
    assert.equal(computePriority({ ...base, amount: 500 }), 'LOW');
    assert.equal(computePriority(base), 'NORMAL');
  });

  it('accepte un montant décimal sans le convertir en approximation', () => {
    const montant = new Prisma.Decimal('900000.5000');
    assert.equal(computePriority({ ...base, amount: montant }), 'HIGH');
  });
});

describe('Délai de réponse', () => {
  it('se compte depuis l’heure du serveur, en avant', () => {
    const maintenant = new Date('2026-09-13T10:00:00Z');
    const limite = deadlineFrom(maintenant);
    assert.ok(limite > maintenant, 'la limite est dans le futur');
    assert.equal((limite.getTime() - maintenant.getTime()) / 3_600_000, RESPONSE_HOURS);
  });

  it('respecte une durée explicite', () => {
    const maintenant = new Date('2026-09-13T10:00:00Z');
    assert.equal(deadlineFrom(maintenant, 24).toISOString(), '2026-09-14T10:00:00.000Z');
  });
});
