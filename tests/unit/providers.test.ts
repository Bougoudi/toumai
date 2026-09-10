import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockPaymentProvider } from '../../src/touma/payments/providers/mock.provider.js';
import { MockLogisticsProvider } from '../../src/touma/logistics/providers/mock.provider.js';
import { signWebhook } from '../helpers/api.js';
import { env } from '../../src/config/env.js';

describe('Touma Pay — adaptateur de démonstration', () => {
  const provider = new MockPaymentProvider();

  it('crée un paiement en attente avec une référence prestataire', async () => {
    const result = await provider.createPayment({
      reference: 'TM-TEST-1',
      amount: '25000',
      currency: 'XAF',
      method: 'MOBILE_MONEY',
      customer: { id: 'u1', email: 'a@b.c', name: 'Test' },
    });
    assert.equal(result.status, 'PENDING');
    assert.match(result.providerRef, /^mockpay_/);
  });

  it('permet de simuler un échec de paiement', async () => {
    const ok = await provider.confirmPayment('mockpay_1');
    assert.equal(ok.status, 'SUCCEEDED');
    const ko = await provider.confirmPayment('mockpay_1', { outcome: 'FAILED' });
    assert.equal(ko.status, 'FAILED');
    assert.ok(ko.failureReason);
  });

  it('accepte un webhook correctement signé', () => {
    const payload = { id: 'evt_1', type: 'payment.succeeded', data: { providerRef: 'mockpay_1', status: 'SUCCEEDED' } };
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret);
    const verification = provider.verifyWebhook(raw, { 'x-touma-signature': signature });
    assert.equal(verification.valid, true);
    assert.equal(verification.eventId, 'evt_1');
    assert.equal(verification.status, 'SUCCEEDED');
  });

  it('rejette un webhook non signé ou mal signé', () => {
    const payload = { id: 'evt_2', type: 'payment.succeeded', data: { providerRef: 'x', status: 'SUCCEEDED' } };
    const { raw } = signWebhook(payload, env.touma.paymentWebhookSecret);
    assert.equal(provider.verifyWebhook(raw, {}).valid, false);
    assert.equal(provider.verifyWebhook(raw, { 'x-touma-signature': 'sha256=00' }).valid, false);
    const { signature } = signWebhook(payload, 'mauvais-secret');
    assert.equal(provider.verifyWebhook(raw, { 'x-touma-signature': signature }).valid, false);
  });
});

describe('Touma Logistics — adaptateur de démonstration', () => {
  const provider = new MockLogisticsProvider();
  const national = { origin: { countryCode: 'TD' }, destination: { countryCode: 'TD' }, parcel: { weightGrams: 1000 }, currency: 'XAF' };
  const corridor = { origin: { countryCode: 'TD' }, destination: { countryCode: 'CM' }, parcel: { weightGrams: 1000 }, currency: 'XAF' };

  it('facture le transfrontalier plus cher que le national', async () => {
    const [nat] = await provider.getQuote(national);
    const [cross] = await provider.getQuote(corridor);
    assert.ok(Number(cross.amount) > Number(nat.amount));
  });

  it('allonge le délai sur le corridor transfrontalier', async () => {
    const [nat] = await provider.getQuote(national);
    const [cross] = await provider.getQuote(corridor);
    assert.ok(cross.etaMaxDays > nat.etaMaxDays);
  });

  it('facture au kilogramme entamé', async () => {
    const [light] = await provider.getQuote(national);
    const [heavy] = await provider.getQuote({ ...national, parcel: { weightGrams: 25000 } });
    assert.ok(Number(heavy.amount) > Number(light.amount));
  });

  it('crée une expédition avec numéro de suivi traçable', async () => {
    const [quote] = await provider.getQuote(corridor);
    const shipment = await provider.createShipment({
      quote,
      origin: { countryCode: 'TD' },
      destination: { countryCode: 'CM' },
      parcel: { weightGrams: 1000 },
      reference: 'TM-TEST-2',
    });
    assert.match(shipment.trackingNumber, /^TOUMA-TDCM-/);
    assert.equal(shipment.status, 'LABEL_CREATED');
  });
});
