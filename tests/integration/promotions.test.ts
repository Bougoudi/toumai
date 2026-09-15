import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Promotions : ce qu'un code réduit, qui le finance, et ce qu'il est impossible
 * de lui faire faire.
 *
 * La règle la plus importante tient en une ligne : une campagne TOUMA ne doit
 * jamais être payée par le vendeur, et une promotion de vendeur ne doit jamais
 * être payée par TOUMA. Les assertions sur la commission le vérifient.
 */
const api = new TestApi();

let buyer: any;
let seller: any;
let admin: any;
let storeId: string;
let productId: string;
const PRICE = 10_000;

/** Remplit le panier et valide la commande avec, éventuellement, un code. */
async function checkout(body: Record<string, unknown> = {}, quantity = 1) {
  await api.post('/api/v1/cart/items', { productId, quantity }, buyer.accessToken);
  return api.post('/api/v1/checkout', { addressId: buyer.addressId, ...body }, buyer.accessToken);
}

async function emptyCart() {
  await api.delete('/api/v1/cart', buyer.accessToken);
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur promo', email: uniqueEmail('pr-seller'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique promo ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Karité promo ${Date.now()}`, price: String(PRICE), quantity: 500, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur promo', email: uniqueEmail('pr-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur promo', phone: '+23590000811', line1: 'Rue 5', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  admin = await registerUser(api, { name: 'Admin promo', email: uniqueEmail('pr-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Codes de réduction : création', () => {
  it('refuse qu’un vendeur crée une promotion à l’échelle de la place de marché', async () => {
    const res = await api.post(
      '/api/v1/coupons',
      { code: `PIRATE${Date.now()}`, type: 'PERCENTAGE', value: '50' },
      seller.accessToken,
    );
    assert.equal(res.status, 403);
  });

  it('refuse un code d’une boutique qui n’est pas la sienne', async () => {
    const other = await registerUser(api, { name: 'Vendeur tiers', email: uniqueEmail('pr-other'), role: 'SELLER', countryCode: 'TD' });
    const res = await api.post(
      '/api/v1/coupons',
      { code: `VOL${Date.now()}`, type: 'PERCENTAGE', value: '10', storeId },
      other.accessToken,
    );
    assert.equal(res.status, 404);
  });

  it('exige une devise pour une remise en montant', async () => {
    const res = await api.post('/api/v1/coupons', { code: `NODEV${Date.now()}`, type: 'FIXED_AMOUNT', value: '2000' }, admin.accessToken);
    assert.equal(res.status, 400);
  });

  it('refuse un pourcentage hors bornes', async () => {
    const res = await api.post('/api/v1/coupons', { code: `TROP${Date.now()}`, type: 'PERCENTAGE', value: '150' }, admin.accessToken);
    assert.equal(res.status, 400);
  });

  it('refuse un code en double', async () => {
    const code = `UNIQ${Date.now()}`;
    assert.equal((await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '5' }, admin.accessToken)).status, 201);
    assert.equal((await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '5' }, admin.accessToken)).status, 409);
  });
});

describe('Codes de réduction : qui paie', () => {
  it('une campagne TOUMA ne réduit pas la commission du vendeur', async () => {
    const code = `TOUMA10-${Date.now()}`;
    await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '10' }, admin.accessToken);

    const res = await checkout({ couponCode: code });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = res.body.orders[0];

    // L'acheteur paie 10 % de moins sur la marchandise…
    assert.equal(order.discountTotal, String(PRICE * 0.1));
    assert.equal(Number(order.total), PRICE + Number(order.shippingTotal) - PRICE * 0.1);
    // …mais la commission reste assise sur le sous-total plein : TOUMA paie sa promotion.
    assert.equal(order.sellerFundedDiscount, '0');
    const stored = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stored.commissionTotal.toString(), stored.subtotal.times('0.05').toString());
  });

  it('une promotion de vendeur réduit son revenu et sa commission', async () => {
    const code = `VENDEUR20-${Date.now()}`;
    const created = await api.post(
      '/api/v1/coupons',
      { code, type: 'PERCENTAGE', value: '20', storeId },
      seller.accessToken,
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.funding, 'STORE', 'un code de boutique est financé par la boutique');

    const res = await checkout({ couponCode: code });
    const order = res.body.orders[0];
    assert.equal(order.discountTotal, String(PRICE * 0.2));
    assert.equal(order.sellerFundedDiscount, String(PRICE * 0.2));

    const stored = await prisma.toumaOrder.findUniqueOrThrow({ where: { id: order.id } });
    // Commission sur le sous-total NET de la remise financée par le vendeur.
    assert.equal(stored.commissionTotal.toString(), stored.subtotal.minus(stored.sellerFundedDiscount).times('0.05').toString());
  });
});

describe('Codes de réduction : garde-fous', () => {
  it('refuse un code inconnu, expiré ou en pause', async () => {
    assert.equal((await checkout({ couponCode: 'NEXISTEPAS' })).status, 400);
    await emptyCart();

    const expired = `EXPIRE${Date.now()}`;
    await api.post(
      '/api/v1/coupons',
      { code: expired, type: 'PERCENTAGE', value: '10', startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-02-01T00:00:00.000Z' },
      admin.accessToken,
    );
    const res = await checkout({ couponCode: expired });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /expiré/i);
    await emptyCart();

    const paused = `PAUSE${Date.now()}`;
    const created = await api.post('/api/v1/coupons', { code: paused, type: 'PERCENTAGE', value: '10' }, admin.accessToken);
    await api.patch(`/api/v1/coupons/${created.body.id}`, { status: 'PAUSED' }, admin.accessToken);
    assert.equal((await checkout({ couponCode: paused })).status, 400);
    await emptyCart();
  });

  it('respecte le minimum d’achat', async () => {
    const code = `MIN${Date.now()}`;
    await api.post(
      '/api/v1/coupons',
      { code, type: 'FIXED_AMOUNT', value: '1000', currency: 'XAF', minOrderAmount: '50000' },
      admin.accessToken,
    );
    const refused = await checkout({ couponCode: code }, 1);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /minimum/i);
    await emptyCart();

    const accepted = await checkout({ couponCode: code }, 6);
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.orders[0].discountTotal, '1000');
  });

  it('plafonne un pourcentage au montant maximal annoncé', async () => {
    const code = `PLAFOND${Date.now()}`;
    await api.post(
      '/api/v1/coupons',
      { code, type: 'PERCENTAGE', value: '50', maxDiscountAmount: '3000' },
      admin.accessToken,
    );
    const res = await checkout({ couponCode: code }, 4);
    assert.equal(res.body.orders[0].discountTotal, '3000', '50 % de 40 000 serait 20 000 : le plafond s’applique');
  });

  it('ne rend jamais une commande négative', async () => {
    const code = `ENORME${Date.now()}`;
    await api.post(
      '/api/v1/coupons',
      { code, type: 'FIXED_AMOUNT', value: '9999999', currency: 'XAF' },
      admin.accessToken,
    );
    const res = await checkout({ couponCode: code });
    const order = res.body.orders[0];
    // La remise est ramenée à la marchandise : la livraison reste due.
    assert.equal(order.discountTotal, String(PRICE));
    assert.ok(Number(order.total) >= 0);
    assert.equal(Number(order.total), Number(order.shippingTotal));
  });

  it('applique la limite globale puis marque le code épuisé', async () => {
    const code = `LIMITE${Date.now()}`;
    await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '5', usageLimit: 1 }, admin.accessToken);

    assert.equal((await checkout({ couponCode: code })).status, 201);
    const second = await checkout({ couponCode: code });
    assert.equal(second.status, 400);

    const stored = await prisma.toumaCoupon.findUniqueOrThrow({ where: { code } });
    assert.equal(stored.usageCount, 1);
    assert.equal(stored.status, 'EXHAUSTED');
    await emptyCart();
  });

  it('applique la limite par acheteur', async () => {
    const code = `PARPERS${Date.now()}`;
    await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '5', usageLimitPerUser: 1 }, admin.accessToken);
    assert.equal((await checkout({ couponCode: code })).status, 201);
    const again = await checkout({ couponCode: code });
    assert.equal(again.status, 400);
    assert.match(again.body.error, /déjà utilisé/i);
    await emptyCart();
  });

  it('limite un code à ses pays de livraison', async () => {
    const code = `CMONLY${Date.now()}`;
    await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '10', countryCodes: ['CM'] }, admin.accessToken);
    const res = await checkout({ couponCode: code });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /pays/i);
    await emptyCart();
  });

  it('simule la remise avant de commander, avec le même calcul', async () => {
    const code = `APERCU${Date.now()}`;
    await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '15' }, admin.accessToken);
    await api.post('/api/v1/cart/items', { productId, quantity: 2 }, buyer.accessToken);

    const preview = await api.post('/api/v1/coupons/preview', { code, countryCode: 'TD' }, buyer.accessToken);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.discount, String(PRICE * 2 * 0.15));

    const res = await api.post('/api/v1/checkout', { addressId: buyer.addressId, couponCode: code }, buyer.accessToken);
    assert.equal(res.body.orders[0].discountTotal, preview.body.discount, 'l’aperçu annonce exactement ce qui est appliqué');
  });

  it('montre au vendeur ce que son code lui a coûté', async () => {
    const code = `COUT${Date.now()}`;
    const created = await api.post('/api/v1/coupons', { code, type: 'PERCENTAGE', value: '10', storeId }, seller.accessToken);
    await checkout({ couponCode: code });

    const stats = await api.get(`/api/v1/coupons/${created.body.id}/redemptions`, seller.accessToken);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totalGranted, String(PRICE * 0.1));
    assert.equal(stats.body.items.length, 1);

    // Un tiers ne voit rien.
    assert.equal((await api.get(`/api/v1/coupons/${created.body.id}/redemptions`, buyer.accessToken)).status, 404);
  });
});
