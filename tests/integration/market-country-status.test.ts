import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { qualifierLignes, qualifierPays } from '../../src/touma/market/market-country.js';
import { intelligenceService } from '../../src/touma/admin/intelligence.service.js';

/**
 * UN SIGNAL GÉOGRAPHIQUE PORTE LE STATUT DE SON MARCHÉ (V29 §43, test critique 3).
 *
 * **Le défaut corrigé.** L'analyse de la demande rendait un code pays nu :
 * `{ countryCode: 'NG', searches: 14 }`. Rien ne distinguait le Tchad, où
 * TOUMA opère, du Nigeria, qui est `PLANNED` — aucune géographie chargée,
 * aucun prestataire, aucun corridor. Les deux arrivaient côte à côte, et un
 * lecteur en concluait que les deux étaient des marchés.
 *
 * Quatorze recherches depuis le Nigeria sont une information réelle. Ce n'est
 * pas de l'activité de marché : c'est de l'intérêt là où rien ne peut aboutir.
 * Confondre les deux fait prendre une demande non servable pour une demande
 * servie — et c'est sur ce genre de confusion qu'on ouvre un marché trop tôt.
 */

before(async () => {
  ensureSchema();
  await ensureReferenceData();
});
after(async () => prisma.$disconnect());

describe('Statut de marché sur un signal géographique', () => {
  it('distingue un marché ouvert d’un pays seulement planifié', async () => {
    await prisma.country.upsert({
      where: { code: 'NG' },
      update: { status: 'PLANNED', active: false, buyingEnabled: false },
      create: { code: 'NG', name: 'Nigeria', currency: 'NGN', dialCode: '+234', timezone: 'Africa/Lagos', status: 'PLANNED', active: false, buyingEnabled: false, sellingEnabled: false },
    });

    const q = await qualifierPays(['TD', 'NG']);

    const tchad = q.get('TD');
    assert.ok(tchad);
    assert.equal(tchad.operating, true);
    assert.match(tchad.statement, /activité commerciale/);

    const nigeria = q.get('NG');
    assert.ok(nigeria);
    assert.equal(nigeria.status, 'PLANNED');
    assert.equal(nigeria.operating, false, 'un pays PLANNED n’est jamais présenté comme un marché ouvert');
    assert.match(nigeria.statement, /intérêt, pas de l’activité de marché/);
  });

  it('ne masque pas les pays fermés : l’intérêt non servi est ce qu’il faut voir', async () => {
    // Masquer aurait été l'autre erreur. Un pays d'où l'on cherche sans
    // pouvoir acheter est précisément le signal d'une équipe d'expansion.
    const lignes = await qualifierLignes([
      { countryCode: 'TD', searches: 40 },
      { countryCode: 'NG', searches: 14 },
    ]);
    assert.equal(lignes.length, 2, 'aucune ligne n’est retirée');
    assert.equal(lignes.find((l) => l.countryCode === 'NG')?.market.operating, false);
  });

  it('un code pays inconnu n’est pas un marché fermé, mais un code inconnu', async () => {
    const q = await qualifierPays(['ZZ']);
    const inconnu = q.get('ZZ');
    assert.equal(inconnu?.status, 'UNKNOWN');
    assert.equal(inconnu?.operating, false);
    assert.match(String(inconnu?.statement), /absent du référentiel/);
  });

  it('un marché suspendu cesse d’être présenté comme ouvert', async () => {
    const code = 'ZW';
    const avant = await prisma.country.findUnique({ where: { code } });
    if (!avant) return;
    await prisma.country.update({ where: { code }, data: { status: 'SUSPENDED', active: true, buyingEnabled: true } });
    // Le statut prime sur les interrupteurs : c'est tout l'objet de V26 §46.
    assert.equal((await qualifierPays([code])).get(code)?.operating, false);
    await prisma.country.update({ where: { code }, data: { status: avant.status, active: avant.active, buyingEnabled: avant.buyingEnabled } });
  });
});

describe('Le tableau de demande non servie porte son âge et ses statuts', () => {
  it('chaque ligne pays est qualifiée, et le bloc dit sa fraîcheur', async () => {
    const rapport = await intelligenceService.unmetDemand(30);

    assert.ok(rapport.freshness, 'le bloc doit dire son âge (§41)');
    assert.ok(['LIVE', 'RECENT', 'STALE', 'NO_DATA'].includes(rapport.freshness.state));
    assert.equal(rapport.freshness.windowDays, 30);

    for (const ligne of rapport.emptySearchesByCountry) {
      assert.ok(ligne.market, 'chaque ligne pays doit porter son marché');
      assert.equal(typeof ligne.market.operating, 'boolean');
      assert.ok(ligne.market.statement.length > 20);
      assert.ok(ligne.freshness, 'chaque ligne doit dire son âge');
    }
  });
});
