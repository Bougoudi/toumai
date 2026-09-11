import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { promoteToAdmin, registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * TOUMA Intelligence.
 *
 * Un écran d'« insights » est l'endroit où l'on invente le plus facilement des
 * chiffres. Ces tests vérifient surtout l'inverse de ce qu'on teste
 * d'habitude : qu'aucun taux ni aucune tendance n'est publié sans le volume qui
 * le justifie, et que la journalisation des recherches ne rattache rien à un
 * compte.
 */
const api = new TestApi();

let admin: any;
let buyer: any;
let seller: any;
let productId: string;
let keyword: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  keyword = `intel${Date.now()}`;

  seller = await registerUser(api, { name: 'Vendeur intel', email: uniqueEmail('in-seller'), role: 'SELLER', countryCode: 'CM' });
  const storeId = (await api.post('/api/v1/stores', { name: `Boutique intel ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  productId = (
    await api.post(
      '/api/v1/products',
      { storeId, title: `Cacao ${keyword}`, price: '12000', quantity: 3, weightGrams: 1000, status: 'ACTIVE' },
      seller.accessToken,
    )
  ).body.id;

  buyer = await registerUser(api, { name: 'Acheteur intel', email: uniqueEmail('in-buyer'), role: 'BUYER', countryCode: 'TD' });
  buyer.addressId = (
    await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Acheteur intel', phone: '+23590000855', line1: 'Rue 3', city: "N'Djamena", countryCode: 'TD' },
      buyer.accessToken,
    )
  ).body.id;

  admin = await registerUser(api, { name: 'Admin intel', email: uniqueEmail('in-admin'), role: 'BUYER', countryCode: 'TD' });
  await promoteToAdmin(admin.user.id);
  admin.accessToken = (await api.post('/api/v1/auth/login', { email: admin.user.email, password: admin.password })).body.accessToken;
});
after(async () => api.stop());

describe('Journalisation des recherches', () => {
  it('enregistre le terme et le nombre de résultats, jamais le compte', async () => {
    const term = `recherche-${keyword}`;
    await api.get(`/api/v1/products?q=${term}`, buyer.accessToken);
    // La journalisation est hors du chemin de réponse : on lui laisse un instant.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const logged = await prisma.toumaSearchQuery.findFirst({ where: { term: term.toLowerCase() } });
    assert.ok(logged, 'la recherche est journalisée');
    assert.equal(logged.resultCount, 0, 'le nombre de résultats réellement obtenu est conservé');
    // Le pays est utile, l'identité ne l'est pas : le modèle ne porte pas d'utilisateur.
    assert.equal(logged.countryCode, 'TD');
    assert.ok(!('userId' in logged), 'aucune recherche n’est rattachée à un compte');
  });

  it('normalise le terme pour pouvoir le regrouper', async () => {
    await api.get(`/api/v1/products?q=${encodeURIComponent(`  CACAO   ${keyword}  `)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const logged = await prisma.toumaSearchQuery.findFirst({
      where: { term: `cacao ${keyword}` },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(logged, 'casse et espaces multiples ne créent pas des termes distincts');
    assert.ok(logged.resultCount > 0, 'cette recherche-là trouve bien un produit');
  });

  it('ne compte pas la pagination comme de nouvelles recherches', async () => {
    const term = `page-${keyword}`;
    await api.get(`/api/v1/products?q=${term}&page=1`);
    await api.get(`/api/v1/products?q=${term}&page=2`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await prisma.toumaSearchQuery.count({ where: { term } }), 1);
  });
});

describe('Tableau de bord Intelligence', () => {
  it('est réservé à l’administration', async () => {
    assert.equal((await api.get('/api/v1/admin/intelligence', seller.accessToken)).status, 403);
    assert.equal((await api.get('/api/v1/admin/intelligence')).status, 401);
  });

  it('remonte la demande non servie', async () => {
    const res = await api.get('/api/v1/admin/intelligence?days=30', admin.accessToken);
    assert.equal(res.status, 200);

    const empty = res.body.demand.emptySearches.map((s: any) => s.term);
    assert.ok(empty.includes(`recherche-${keyword}`), 'une recherche sans résultat est signalée');
    assert.ok(res.body.demand.topSearches.length > 0);
    // Chaque terme le plus cherché porte le nombre moyen de résultats obtenus.
    assert.ok(res.body.demand.topSearches.every((s: any) => s.averageResults !== undefined));
  });

  it('signale les appels d’offres restés sans réponse', async () => {
    const rfq = await api.post(
      '/api/v1/rfqs',
      { title: `Besoin sans réponse ${keyword}`, countryCode: 'TD', currency: 'XAF', items: [{ name: 'Sorgho', quantity: 500, unit: 'kg' }] },
      buyer.accessToken,
    );
    assert.equal(rfq.status, 201);

    const res = await api.get('/api/v1/admin/intelligence', admin.accessToken);
    assert.ok(res.body.demand.unansweredRfqs.some((r: any) => r.id === rfq.body.id));
  });

  it('ne publie ni taux ni tendance sans volume suffisant', async () => {
    // Une seule commande sur le corridor : le taux de litige n'a aucun sens.
    await api.post('/api/v1/cart/items', { productId, quantity: 1 }, buyer.accessToken);
    const checkout = await api.post('/api/v1/checkout', { addressId: buyer.addressId }, buyer.accessToken);
    const order = checkout.body.orders[0];
    const payment = await api.post('/api/v1/payments/create', { orderId: order.id, method: 'MOBILE_MONEY' }, buyer.accessToken);
    await api.post('/api/v1/payments/confirm', { paymentId: payment.body.payment.id }, buyer.accessToken);

    const res = await api.get('/api/v1/admin/intelligence', admin.accessToken);
    const corridor = res.body.corridors.find((c: any) => c.from === 'CM' && c.to === 'TD');
    assert.ok(corridor, 'le corridor CM → TD apparaît');
    assert.ok(corridor.orders >= 1);
    assert.equal(corridor.crossBorder, true);
    if (corridor.orders < res.body.minVolumeForTrend) {
      assert.equal(corridor.disputeRate, null, 'aucun taux publié en dessous du seuil de volume');
    }
    // Le délai n'est publié qu'une fois une commande réellement livrée.
    if (corridor.deliveredOrders === 0) assert.equal(corridor.averageDeliveryDays, null);

    // Même règle pour les catégories : le volume brut est toujours donné.
    for (const category of res.body.categories) {
      assert.equal(typeof category.sold, 'number');
      if (category.previousSold < res.body.minVolumeForTrend) assert.equal(category.change, null);
    }
  });

  it('mesure la fiabilité des paiements par méthode, volume à l’appui', async () => {
    const res = await api.get('/api/v1/admin/intelligence', admin.accessToken);
    const mobile = res.body.payments.find((p: any) => p.method === 'MOBILE_MONEY');
    assert.ok(mobile, 'le mobile money apparaît');
    assert.ok(mobile.total >= 1);
    assert.equal(typeof mobile.succeeded, 'number');
    if (mobile.succeeded + mobile.failed < res.body.minVolumeForTrend) {
      assert.equal(mobile.successRate, null, 'pas de taux de réussite sans volume');
    }
  });

  it('repère les produits en tension', async () => {
    const res = await api.get('/api/v1/admin/intelligence', admin.accessToken);
    const tension = res.body.stockTension.find((t: any) => t.product.id === productId);
    if (tension) {
      assert.ok(tension.sold > 0, 'un produit en tension a été vendu');
      assert.equal(typeof tension.stock, 'number');
      // Les jours de stock ne sont estimés que s'il y a eu des ventes.
      assert.ok(tension.daysOfStock === null || tension.daysOfStock >= 0);
    }
  });
});
