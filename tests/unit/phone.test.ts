import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPhone, normalizePhone, tryNormalizePhone } from '../../src/touma/lib/phone.js';

describe('Normalisation des numéros de téléphone', () => {
  it('range les quatre écritures d’un même numéro tchadien sous une seule forme', () => {
    // Le défaut corrigé : la base tenait ces quatre chaînes pour quatre numéros
    // différents. Un acheteur ne pouvait donc pas être reconnu, ni joint.
    const attendu = '+23566123456';
    for (const saisie of ['66123456', '66 12 34 56', '+235 66123456', '00235 66-12-34-56', '+235-66-12-34-56']) {
      assert.equal(normalizePhone(saisie).e164, attendu, `« ${saisie} » doit donner ${attendu}`);
    }
  });

  it('retire le zéro d’appel national, qui ne fait pas partie du numéro', () => {
    assert.equal(normalizePhone('066123456').e164, '+23566123456');
  });

  it('respecte le plan de numérotation du pays', () => {
    // Un numéro tchadien compte huit chiffres. Sept, c'est une faute de frappe,
    // et l'accepter revient à promettre une livraison qu'on ne pourra pas
    // annoncer.
    assert.throws(() => normalizePhone('6612345'), /8 chiffres/);
    assert.throws(() => normalizePhone('661234567'), /8 chiffres/);
    // Le Cameroun en compte neuf : le même numéro à huit chiffres y est refusé.
    assert.equal(normalizePhone('612345678', '237').e164, '+237612345678');
    assert.throws(() => normalizePhone('61234567', '237'), /9 chiffres/);
  });

  it('utilise l’indicatif du compte, jamais celui du serveur', () => {
    assert.equal(normalizePhone('612345678', '237').dialCode, '237');
    assert.equal(normalizePhone('66123456').dialCode, '235');
  });

  it('refuse de deviner un indicatif inconnu', () => {
    // Mieux vaut un refus explicite qu'un numéro rangé au hasard sous +23.
    assert.throws(() => normalizePhone('+9995551234'), /Indicatif pays non reconnu/);
  });

  it('refuse le vide et le non-numérique', () => {
    assert.throws(() => normalizePhone('   '), /requis/);
    assert.throws(() => normalizePhone('téléphone'), /invalide/);
  });

  it('rend null plutôt que d’échouer quand le numéro est facultatif', () => {
    assert.equal(tryNormalizePhone(null), null);
    assert.equal(tryNormalizePhone(''), null);
    assert.equal(tryNormalizePhone('pas un numéro'), null);
    assert.equal(tryNormalizePhone('66123456'), '+23566123456');
  });

  it('sépare affichage et stockage', () => {
    // La forme lisible est cosmétique : c'est l'E.164 qui est comparée.
    assert.equal(formatPhone('+23566123456'), '+235 66 12 34 56');
    assert.equal(normalizePhone(formatPhone('+23566123456')).e164, '+23566123456');
  });
});
