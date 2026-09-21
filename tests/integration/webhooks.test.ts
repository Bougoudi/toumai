import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { promoteToAdmin, registerUser, signWebhook, signWebhookRaw, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { purgeWebhookDeliveries } from '../../src/touma/payments/webhook-log.js';
import { REDACTED } from '../../src/touma/lib/redact.js';

/**
 * Traçabilité des webhooks (V20).
 *
 * Deux manques déclarés et comblés ici :
 *
 * 1. **Un webhook refusé ne laissait aucune trace.** Il était journalisé puis
 *    oublié — alors que c'est précisément celui qu'on voudra relire le jour où
 *    quelqu'un tente d'en forger un.
 * 2. **Aucune validation d'horodatage.** Un webhook valide capté puis rejoué
 *    des mois plus tard, avec un identifiant jamais vu, passait l'anti-rejeu.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let admin: any;
let storeId: string;

/** Commande payée : fournit une référence prestataire réelle à viser. */
async function paiementEnAttente() {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Article webhook ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, price: '12000', quantity: 20, weightGrams: 800, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, buyer.accessToken);
  const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];
  const paiement = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
  const payment = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: paiement.body.payment.id } });
  return payment;
}

/** Dernière trace écrite pour ce corps. */
async function traceDe(raw: Buffer) {
  const empreinte = createHash('sha256').update(raw).digest('hex');
  return prisma.toumaWebhookDelivery.findFirst({ where: { bodySha256: empreinte }, orderBy: { createdAt: 'desc' } });
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur webhook', email: uniqueEmail('wh-seller'), role: 'SELLER', countryCode: 'TD' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique webhook ${Date.now()}`, countryCode: 'TD' }, seller.accessToken)).body.id;
  await prisma.toumaStore.update({ where: { id: storeId }, data: { status: 'ACTIVE' } });

  buyer = await registerUser(api, { name: 'Acheteur webhook', email: uniqueEmail('wh-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur webhook', phone: '+23566000777', line1: 'Avenue Charles de Gaulle', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  admin = await registerUser(api, { name: 'Admin webhook', email: uniqueEmail('wh-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});

after(async () => {
  await api.stop();
});

describe('Un webhook refusé laisse une trace', () => {
  it('consigne une signature invalide, avec son origine', async () => {
    const payload = { id: `evt-forge-${Date.now()}`, type: 'payment.succeeded', data: { providerRef: 'mockpay_inexistant', status: 'SUCCEEDED' } };
    const { raw } = signWebhook(payload, 'secret-de-l-attaquant');

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', {
      raw,
      headers: { 'x-touma-signature': 'sha256=deadbeef', 'user-agent': 'forgeur/1.0' },
    });
    assert.equal(res.status, 403);

    const trace = await traceDe(raw);
    assert.ok(trace, 'la tentative doit être consignée');
    assert.equal(trace!.outcome, 'INVALID_SIGNATURE');
    assert.equal(trace!.signatureValid, false);
    assert.equal(trace!.userAgent, 'forgeur/1.0');
    assert.ok(trace!.bodyBytes > 0);
  });

  it('ne dit jamais à l’appelant pourquoi sa signature est refusée', async () => {
    // Le motif est dans la trace, pas dans la réponse : le donner aiderait à
    // produire une signature valide.
    const payload = { id: `evt-motif-${Date.now()}`, type: 'payment.succeeded', data: { providerRef: 'x', status: 'SUCCEEDED' } };
    const { raw } = signWebhook(payload, env.touma.paymentWebhookSecret);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': 'v1=sans-horodatage' } });
    assert.equal(res.status, 403);
    const rendu = JSON.stringify(res.body);
    assert.ok(!rendu.includes('mal formée'), 'le motif détaillé ne doit pas sortir');
    assert.ok(!rendu.includes('absent'), 'le motif détaillé ne doit pas sortir');

    const trace = await traceDe(raw);
    assert.match(trace!.reason ?? '', /mal formée|absent/i);
  });

  it('vérifie la signature sur les octets reçus, quelle que soit leur mise en forme', async () => {
    /**
     * Le défaut que ce test existe pour empêcher.
     *
     * `express.json()` était monté avant le routeur de webhooks. Il consommait
     * le flux ; `express.raw()` n'avait plus rien à lire ; la signature était
     * alors vérifiée sur une **re-sérialisation** compacte du corps analysé.
     * Un prestataire réel signe ses propres octets — Stripe, un agrégateur
     * mobile money, n'importe lequel — avec ses espaces et son ordre de clés.
     * Aucune de ses notifications n'aurait passé la vérification : ses
     * paiements seraient restés non confirmés, rejetés comme falsifiés.
     *
     * Toute la suite restait verte parce que `signWebhook` signait toujours la
     * sortie de `JSON.stringify`, c'est-à-dire la seule forme qui survivait à
     * l'aller-retour. D'où des octets écrits à la main ici.
     */
    const ref = `mockpay_forme_${Date.now()}`;
    const corps = `{\n  "id": "evt-forme-${Date.now()}",\n  "type": "payment.succeeded",\n  "data": { "providerRef": "${ref}", "status": "SUCCEEDED" }\n}`;
    const { raw, signature } = signWebhookRaw(Buffer.from(corps, 'utf8'), env.touma.paymentWebhookSecret);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    // 404 « paiement inconnu » : la signature est passée, seule la référence
    // n'existe pas. Un 403 signifierait que la mise en forme a été jugée
    // falsifiée — le défaut d'origine.
    assert.equal(res.status, 404, 'une signature valide sur un corps espacé doit être acceptée');

    const trace = await traceDe(raw);
    assert.equal(trace!.signatureValid, true);
    assert.equal(trace!.outcome, 'UNKNOWN_PAYMENT');
  });

  it('consigne un prestataire inconnu plutôt que de répondre 500', async () => {
    const payload = { id: `evt-inconnu-${Date.now()}`, type: 'payment.succeeded', data: {} };
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret);

    const res = await api.request('POST', '/api/v1/payments/webhook/prestataire-fantome', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(res.status, 404, 'un code de prestataire inconnu est une erreur client, pas une panne serveur');

    const trace = await traceDe(raw);
    assert.equal(trace!.outcome, 'UNKNOWN_PROVIDER');
  });

  it('consigne un webhook signé qui ne désigne aucun paiement connu', async () => {
    const payload = {
      id: `evt-orphelin-${Date.now()}`,
      type: 'payment.succeeded',
      data: { providerRef: 'mockpay_jamais_emis', status: 'SUCCEEDED' },
    };
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(res.status, 404);

    const trace = await traceDe(raw);
    assert.equal(trace!.outcome, 'UNKNOWN_PAYMENT');
    assert.equal(trace!.signatureValid, true, 'la signature était bonne : seule la référence est inconnue');
    assert.equal(trace!.providerRef, 'mockpay_jamais_emis');
  });
});

describe('La fenêtre d’acceptation', () => {
  it('refuse un webhook correctement signé mais périmé', async () => {
    // Le cas visé : un webhook valide capté en transit, jamais délivré, puis
    // injecté bien plus tard. Son identifiant n'ayant jamais été vu,
    // l'anti-rejeu ne le rattrape pas.
    const payment = await paiementEnAttente();
    const payload = {
      id: `evt-vieux-${Date.now()}`,
      type: 'payment.succeeded',
      data: { providerRef: payment.providerRef, status: 'SUCCEEDED' },
    };
    const vieux = new Date(Date.now() - (env.touma.webhookToleranceSeconds + 600) * 1000);
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret, vieux);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(res.status, 403);

    const trace = await traceDe(raw);
    assert.equal(trace!.outcome, 'STALE');
    assert.ok((trace!.signatureAgeSeconds ?? 0) > env.touma.webhookToleranceSeconds);

    const apres = await prisma.toumaPayment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.notEqual(apres.status, 'SUCCEEDED', 'un webhook périmé ne fait pas entrer d’argent');
  });

  it('refuse aussi un horodatage dans le futur', async () => {
    // Une horloge fausse ou une tentative de prolonger la fenêtre : les deux se
    // traitent pareil.
    const payment = await paiementEnAttente();
    const payload = {
      id: `evt-futur-${Date.now()}`,
      type: 'payment.succeeded',
      data: { providerRef: payment.providerRef, status: 'SUCCEEDED' },
    };
    const futur = new Date(Date.now() + (env.touma.webhookToleranceSeconds + 600) * 1000);
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret, futur);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(res.status, 403);
    assert.equal((await traceDe(raw))!.outcome, 'STALE');
  });

  it('accepte un webhook frais, et le consigne comme appliqué', async () => {
    const payment = await paiementEnAttente();
    const payload = {
      id: `evt-frais-${Date.now()}`,
      type: 'payment.succeeded',
      data: { providerRef: payment.providerRef, status: 'SUCCEEDED' },
    };
    const { raw, signature } = signWebhook(payload, env.touma.paymentWebhookSecret);

    const res = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(res.status, 200);
    assert.equal(res.body.duplicate, false);

    const trace = await traceDe(raw);
    assert.equal(trace!.outcome, 'ACCEPTED');
    assert.equal(trace!.paymentId, payment.id);
    assert.ok(Math.abs(trace!.signatureAgeSeconds ?? 999) <= 60);

    // Un rejeu est distingué de l'acceptation, et laisse sa propre trace.
    const rejeu = await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': signature } });
    assert.equal(rejeu.body.duplicate, true);
    assert.equal((await traceDe(raw))!.outcome, 'DUPLICATE');
  });
});

describe('Le corps consigné', () => {
  it('ne recopie jamais un secret présent dans le corps', async () => {
    // Le point d'entrée est public : personne ne garantit ce qu'un tiers y
    // poste. La rédaction est donc appliquée avant écriture, pas espérée.
    const payload = {
      id: `evt-secret-${Date.now()}`,
      type: 'payment.succeeded',
      data: { providerRef: 'mockpay_x', status: 'SUCCEEDED' },
      apiKey: 'sk_live_abcdefgh12345678',
      card: { cardNumber: '4111111111111111', cvv: '321' },
    };
    const { raw } = signWebhook(payload, 'mauvais-secret');
    await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': 'sha256=00' } });

    const trace = await traceDe(raw);
    const extrait = trace!.bodyExcerpt ?? '';
    assert.ok(!extrait.includes('sk_live_abcdefgh12345678'), 'la clé du prestataire ne doit jamais être conservée');
    assert.ok(!extrait.includes('4111111111111111'), 'le numéro de carte ne doit jamais être conservé');

    // Le cryptogramme se vérifie sur le champ, pas par recherche de sous-chaîne :
    // trois chiffres se retrouvent par hasard dans un horodatage.
    const relu = JSON.parse(extrait);
    assert.equal(relu.card.cvv, REDACTED, 'le cryptogramme ne doit jamais être conservé');
    assert.equal(relu.card.cardNumber, REDACTED);
    assert.equal(relu.apiKey, REDACTED);
    assert.equal(relu.type, 'payment.succeeded', 'le reste du corps doit rester exploitable');
  });

  it('borne ce qu’un appelant non authentifié peut écrire en base', async () => {
    const gros = { id: 'evt-gros', bourrage: 'z'.repeat(120_000) };
    const { raw } = signWebhook(gros, 'mauvais-secret');
    await api.request('POST', '/api/v1/payments/webhook/mock', { raw, headers: { 'x-touma-signature': 'sha256=00' } });

    const trace = await traceDe(raw);
    assert.ok(trace, 'la tentative est tout de même consignée');
    assert.ok((trace!.bodyExcerpt ?? '').length <= 2100, 'l’extrait est tronqué');
    assert.equal(trace!.bodyBytes, raw.byteLength, 'la taille réelle reste connue');
  });
});

describe('Relecture et purge', () => {
  it('l’administration relit les tentatives et les compte par issue', async () => {
    const res = await api.get('/api/v1/admin/webhooks?outcome=INVALID_SIGNATURE', admin.accessToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0);
    assert.ok(res.body.items.every((t: any) => t.outcome === 'INVALID_SIGNATURE'));
    assert.ok(res.body.byOutcome.some((r: any) => r.outcome === 'INVALID_SIGNATURE' && r.count > 0));
  });

  it('reste fermée à qui n’est pas administrateur', async () => {
    const res = await api.get('/api/v1/admin/webhooks', buyer.accessToken);
    assert.ok([403, 404].includes(res.status), `attendu 403/404, reçu ${res.status}`);
  });

  it('se purge : une table qu’un tiers fait grossir doit pouvoir rétrécir', async () => {
    const vieille = await prisma.toumaWebhookDelivery.create({
      data: {
        provider: 'mock',
        outcome: 'INVALID_SIGNATURE',
        signatureValid: false,
        bodySha256: createHmac('sha256', 'x').update('vieux').digest('hex'),
        bodyBytes: 12,
        createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000),
      },
    });

    const supprimees = await purgeWebhookDeliveries(90);
    assert.ok(supprimees >= 1);
    assert.equal(await prisma.toumaWebhookDelivery.findUnique({ where: { id: vieille.id } }), null);

    // Les traces récentes, elles, restent.
    assert.ok((await prisma.toumaWebhookDelivery.count()) > 0);
  });
});
