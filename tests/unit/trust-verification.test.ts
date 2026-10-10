import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assess, LEVELS, requirementsFor, SIGNALS } from '../../src/touma/trust/verification-levels.js';
import { verificationProvider, setVerificationProvider } from '../../src/touma/trust/verification-provider.js';

/**
 * Les niveaux de vérification décident de ce qu'un badge veut dire. Le risque
 * n'est pas qu'un vendeur soit refusé à tort : c'est qu'un niveau soit accordé
 * sans que la vérification correspondante ait eu lieu.
 */
describe('Niveaux de vérification', () => {
  it('cumule les exigences du niveau précédent', () => {
    const basic = requirementsFor('BASIC');
    const business = requirementsFor('BUSINESS');
    for (const code of basic) assert.ok(business.includes(code), `${code} devrait rester exigé`);
    assert.ok(business.length > basic.length);
  });

  it('n’exige que des signaux déclarés', () => {
    for (const definition of LEVELS) {
      for (const code of definition.requires) {
        assert.ok(SIGNALS[code], `signal non déclaré : ${code}`);
      }
    }
  });

  it('n’accorde rien sans signal', () => {
    const r = assess('BASIC', new Set(), 0);
    assert.equal(r.granted, 'NONE');
    assert.equal(r.missing.length, 2);
  });

  it('accorde BASIC quand ses deux signaux sont établis', () => {
    const r = assess('BASIC', new Set(['EMAIL_ON_FILE', 'IDENTITY_DOCUMENT']), 0);
    assert.equal(r.granted, 'BASIC');
    assert.deepEqual(r.missing, []);
  });

  it('refuse PRO à qui n’a pas l’antériorité, même avec tous les documents', () => {
    // Un dossier complet ne remplace pas un historique de livraisons.
    const signaux = new Set([
      'EMAIL_ON_FILE',
      'IDENTITY_DOCUMENT',
      'ADDRESS_DECLARED',
      'COMPANY_DOCUMENTS',
      'TRANSACTION_HISTORY',
    ]);
    assert.equal(assess('PRO', signaux, 10).granted, 'BUSINESS');
    assert.equal(assess('PRO', signaux, 25).granted, 'PRO');
  });

  it('déclare ENTERPRISE hors d’atteinte tant qu’aucun prestataire n’est engagé', () => {
    // Le point le plus important du fichier : ne pas accorder un niveau dont
    // les signaux ne peuvent pas être établis. Mieux vaut inatteignable
    // qu'accordé à tort.
    const tout = new Set([
      'EMAIL_ON_FILE',
      'IDENTITY_DOCUMENT',
      'ADDRESS_DECLARED',
      'COMPANY_DOCUMENTS',
      'TRANSACTION_HISTORY',
    ]);
    const r = assess('ENTERPRISE', tout, 500);
    assert.equal(r.granted, 'PRO');
    assert.equal(r.blockedByProvider, true);
    const codes = r.missing.map((m) => m.code).sort();
    assert.deepEqual(codes, ['COMPANY_REGISTRY', 'PAYOUT_ACCOUNT']);
    for (const m of r.missing) {
      assert.equal(m.blockedByProvider, true);
      assert.ok(m.meaning.length > 10, 'ce qui manque doit être dit en clair');
    }
  });

  it('cesse de bloquer dès qu’un prestataire est réellement configuré', () => {
    const tout = new Set([
      'EMAIL_ON_FILE',
      'IDENTITY_DOCUMENT',
      'ADDRESS_DECLARED',
      'COMPANY_DOCUMENTS',
      'TRANSACTION_HISTORY',
      'COMPANY_REGISTRY',
      'PAYOUT_ACCOUNT',
    ]);
    const r = assess('ENTERPRISE', tout, 500, new Set(['COMPANY_REGISTRY', 'PAYOUT_ACCOUNT']));
    assert.equal(r.granted, 'ENTERPRISE');
    assert.equal(r.blockedByProvider, false);
  });
});

describe('Frontière KYC / KYB', () => {
  it('expose les trois opérations attendues', () => {
    setVerificationProvider(null);
    const provider = verificationProvider();
    for (const methode of ['submitVerification', 'getVerificationStatus', 'handleWebhook'] as const) {
      assert.equal(typeof provider[methode], 'function');
    }
  });

  it('déclare franchement que la revue est humaine, et n’approuve rien tout seul', async () => {
    setVerificationProvider(null);
    const provider = verificationProvider();
    const r = await provider.submitVerification({
      caseId: 'cas-1',
      storeId: 'boutique-1',
      legalName: 'Entreprise',
      businessType: 'COMPANY',
      documentRefs: ['ref-1'],
    });
    assert.equal(r.status, 'PENDING', 'un dépôt ne vaut jamais approbation');
    assert.deepEqual(r.establishedSignals, [], 'aucun signal n’est attesté par le dépôt lui-même');
  });

  it('ne simule jamais une vérification externe absente', async () => {
    // Une simulation rendant APPROVED ferait passer pour vérifié quelqu'un que
    // personne n'a vérifié : c'est la faute que le module doit rendre impossible.
    const { verificationProvider: fabrique } = await import('../../src/touma/trust/verification-provider.js');
    setVerificationProvider(null);
    process.env.TOUMA_TRUST_VERIFICATION_ENABLED = 'false';
    // L'environnement est lu au chargement : on vérifie la forme du refus sur
    // l'implémentation non configurée, atteinte via le drapeau.
    const { configuredProviderSignals } = await import('../../src/touma/trust/verification-provider.js');
    assert.equal(configuredProviderSignals().size, 0, 'aucun prestataire ne doit être déclaré configuré');
    delete process.env.TOUMA_TRUST_VERIFICATION_ENABLED;
    setVerificationProvider(null);
    assert.ok(fabrique());
  });

  it('refuse un webhook non signé plutôt que de l’interpréter', async () => {
    setVerificationProvider(null);
    const r = await verificationProvider().handleWebhook({ status: 'APPROVED' }, undefined);
    assert.equal(r, null, 'un webhook sans prestataire engagé ne doit rien produire');
  });
});
