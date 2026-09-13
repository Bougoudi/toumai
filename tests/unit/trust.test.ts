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

describe('Machine d’état d’un retour', () => {
  it('déclare une transition pour chaque statut, et aucune en arrière', async () => {
    // Le défaut qui a fait rougir la CI : trois statuts ajoutés à
    // l'énumération, la table des transitions laissée en arrière. Le typage
    // l'attrape — mais seulement contre un client Prisma à jour.
    const { RETURN_TRANSITIONS } = await import('../../src/touma/returns/return.service.js');
    const statuts = Object.keys(RETURN_TRANSITIONS);
    assert.deepEqual(
      statuts.sort(),
      ['APPROVED', 'CANCELLED', 'CLOSED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'REFUND_PENDING', 'REJECTED', 'REQUESTED', 'UNDER_REVIEW'],
    );

    // Aucune issue ne revient en arrière.
    for (const terminal of ['REFUNDED', 'REJECTED', 'CANCELLED'] as const) {
      assert.deepEqual(RETURN_TRANSITIONS[terminal], ['CLOSED'], `${terminal} ne mène qu’à l’archivage`);
    }
    assert.deepEqual(RETURN_TRANSITIONS.CLOSED, [], 'un dossier clos ne repart pas');

    // L'état intermédiaire qui manquait : reçu, accepté, argent pas encore parti.
    assert.ok(RETURN_TRANSITIONS.RECEIVED.includes('REFUND_PENDING'));
    assert.ok(RETURN_TRANSITIONS.REFUND_PENDING.includes('REFUNDED'));
  });
});
