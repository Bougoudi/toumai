import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyRate, assertSameCurrency, currencyDecimals, format, money, multiply, roundTo, sum } from '../../src/touma/lib/money.js';

describe('Money — arithmétique financière', () => {
  it('additionne sans erreur de flottant (0,1 + 0,2 = 0,3)', () => {
    assert.equal(sum(['0.1', '0.2']).toString(), '0.3');
    // Le même calcul en flottant JavaScript est faux : c'est exactement ce que
    // l'utilitaire Money évite.
    assert.notEqual(0.1 + 0.2, 0.3);
  });

  it('multiplie un prix par une quantité sans perte', () => {
    assert.equal(multiply('19.99', 3).toString(), '59.97');
    assert.equal(multiply('16500', 12).toString(), '198000');
  });

  it('arrondit selon les décimales de la devise', () => {
    assert.equal(currencyDecimals('XAF'), 0);
    assert.equal(currencyDecimals('EUR'), 2);
    assert.equal(roundTo('1250.6', 'XAF').toString(), '1251');
    assert.equal(roundTo('10.005', 'EUR').toString(), '10.01');
  });

  it('applique un taux de commission puis arrondit', () => {
    assert.equal(applyRate('100000', 0.05, 'XAF').toString(), '5000');
    assert.equal(applyRate('19.99', 0.08, 'EUR').toString(), '1.6');
  });

  it('refuse toute conversion approximative entre devises', () => {
    assert.doesNotThrow(() => assertSameCurrency('XAF', 'xaf'));
    assert.throws(() => assertSameCurrency('XAF', 'EUR'), /Devises incompatibles/);
  });

  it('formate un montant pour l’affichage', () => {
    assert.match(format('25000', 'XAF'), /25\s?000 XAF/);
    assert.match(format(money('12.5'), 'EUR'), /12,50 EUR/);
  });
});
