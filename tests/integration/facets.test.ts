import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Facettes de recherche.
 *
 * Le point qui compte : le compteur d'une dimension se calcule **sans** le
 * filtre de cette dimension. Sinon, choisir « Cameroun » mettrait tous les
 * autres pays à zéro et l'acheteur ne pourrait plus changer d'avis sans tout
 * réinitialiser — c'est le défaut classique des facettes mal faites.
 */
const api = new TestApi();

let keyword: string;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  keyword = `facettes${Date.now()}`;

  const sellerCm = await registerUser(api, { name: 'Vendeur CM', email: uniqueEmail('fa-cm'), role: 'SELLER', countryCode: 'CM' });
  const storeCm = (await api.post('/api/v1/stores', { name: `Facettes CM ${Date.now()}`, countryCode: 'CM' }, sellerCm.accessToken)).body.id;
  const sellerTd = await registerUser(api, { name: 'Vendeur TD', email: uniqueEmail('fa-td'), role: 'SELLER', countryCode: 'TD' });
  const storeTd = (await api.post('/api/v1/stores', { name: `Facettes TD ${Date.now()}`, countryCode: 'TD' }, sellerTd.accessToken)).body.id;

  // Trois produits camerounais, deux tchadiens, des prix étalés et un en rupture.
  const products: Array<[string, string, string, number]> = [
    [storeCm, 'Cacao', '1000', 10],
    [storeCm, 'Café', '5000', 10],
    [storeCm, 'Karité', '20000', 0],
    [storeTd, 'Sésame', '2000', 10],
    [storeTd, 'Gomme arabique', '30000', 10],
  ];
  for (const [storeId, title, price, quantity] of products) {
    const token = storeId === storeCm ? sellerCm.accessToken : sellerTd.accessToken;
    await api.post(
      '/api/v1/products',
      { storeId, title: `${title} ${keyword}`, price, quantity, weightGrams: 1000, status: 'ACTIVE' },
      token,
    );
  }
});
after(async () => api.stop());

describe('Facettes', () => {
  it('compte les résultats par pays', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}`);
    assert.equal(res.status, 200);
    const cm = res.body.countries.find((c: any) => c.code === 'CM');
    const td = res.body.countries.find((c: any) => c.code === 'TD');
    assert.equal(cm.count, 3);
    assert.equal(td.count, 2);
    assert.ok(cm.name, 'le nom du pays est renvoyé, pas seulement son code');
  });

  it('garde les autres pays comptés quand un pays est déjà choisi', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}&country=CM`);
    const td = res.body.countries.find((c: any) => c.code === 'TD');
    // C'est tout l'intérêt : l'acheteur voit qu'il reste 2 produits au Tchad.
    assert.equal(td.count, 2, 'le filtre pays ne doit pas s’appliquer à sa propre facette');
  });

  it('applique en revanche les autres filtres aux facettes', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}&country=CM`);
    // La facette disponibilité tient compte du filtre pays : 2 en stock sur 3.
    assert.equal(res.body.availability.inStock, 2);
    assert.equal(res.body.availability.outOfStock, 1);
  });

  it('propose des tranches de prix tirées des prix réels', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}`);
    assert.equal(res.body.price.currency, 'XAF');
    assert.equal(res.body.price.min, '1000');
    assert.equal(res.body.price.max, '30000');
    assert.ok(res.body.price.buckets.length >= 2);
    // Aucune tranche vide : une tranche sans résultat n'aide personne.
    assert.ok(res.body.price.buckets.every((b: any) => b.count > 0));
    // La somme des tranches couvre bien tous les produits.
    assert.equal(res.body.price.buckets.reduce((acc: number, b: any) => acc + b.count, 0), 5);
  });

  it('ne réduit pas les tranches de prix quand un prix est déjà filtré', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}&maxPrice=2000`);
    assert.equal(res.body.price.buckets.reduce((acc: number, b: any) => acc + b.count, 0), 5);
  });

  it('compte les produits des boutiques vérifiées', async () => {
    const res = await api.get(`/api/v1/products/facets?q=${keyword}`);
    assert.equal(typeof res.body.verified, 'number');
    // Aucune boutique du test n'est vérifiée : le compteur doit le dire.
    assert.equal(res.body.verified, 0);
  });

  it('reste cohérent avec la liste elle-même', async () => {
    const list = await api.get(`/api/v1/products?q=${keyword}&country=CM&availability=in_stock`);
    const facets = await api.get(`/api/v1/products/facets?q=${keyword}&country=CM&availability=in_stock`);
    // Le compteur « en stock » de la facette correspond au total de la liste.
    assert.equal(facets.body.availability.inStock, list.body.total);
  });

  it('ne renvoie aucune facette pour une recherche sans résultat', async () => {
    const res = await api.get('/api/v1/products/facets?q=zzzz-aucun-resultat-zzzz');
    assert.equal(res.body.countries.length, 0);
    assert.equal(res.body.categories.length, 0);
    assert.equal(res.body.price.buckets.length, 0);
    assert.equal(res.body.availability.inStock, 0);
  });
});
