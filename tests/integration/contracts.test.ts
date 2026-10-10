import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Country, Paginated, Product, ProductSummary } from '@touma/contracts';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Conformité au contrat public (`packages/contracts`).
 *
 * Un paquet de types que personne ne confronte à la réalité est une
 * documentation qui vieillit en silence : le serveur renomme un champ, le
 * paquet continue de promettre l'ancien, et l'interface qui s'y fie affiche du
 * vide. Ces tests interrogent l'API réelle et vérifient que ce qui revient est
 * bien ce que le contrat annonce.
 *
 * Le point le plus important est le dernier : **aucun montant n'arrive en
 * nombre**. Un flottant JavaScript ne représente pas fidèlement une somme
 * d'argent, et tout le reste de la plateforme travaille en décimal exact.
 */
const api = new TestApi();

let slug = '';

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const seller = await registerUser(api, { name: 'Vendeur contrat', email: uniqueEmail('ct-seller'), role: 'SELLER', countryCode: 'CM' });
  const storeId = (await api.post('/api/v1/stores', { name: `Boutique contrat ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  const product = await api.post(
    '/api/v1/products',
    { storeId, title: `Sésame contrat ${Date.now()}`, price: '78500', quantity: 12, weightGrams: 1000, minOrderQty: 5, status: 'ACTIVE' },
    seller.accessToken,
  );
  slug = product.body.slug;
});
after(async () => api.stop());

/** Vérifie qu'une clé est présente et du type attendu. */
function champ(objet: Record<string, unknown>, cle: string, type: 'string' | 'number' | 'boolean' | 'object', nullable = false): void {
  assert.ok(cle in objet, `champ « ${cle} » absent de la réponse`);
  const valeur = objet[cle];
  if (nullable && valeur === null) return;
  assert.equal(typeof valeur, type, `champ « ${cle} » : ${typeof valeur} au lieu de ${type}`);
}

describe('Contrat public — catalogue', () => {
  it('la liste des produits a la forme paginée annoncée', async () => {
    const res = await api.get('/api/v1/products?limit=5');
    assert.equal(res.status, 200);
    const body = res.body as Paginated<ProductSummary>;

    for (const cle of ['page', 'limit', 'total', 'pages'] as const) champ(body as never, cle, 'number');
    champ(body as never, 'hasNext', 'boolean');
    assert.ok(Array.isArray(body.items), 'items est une liste');
    assert.ok(body.items.length > 0, 'le catalogue de test n’est pas vide');

    const item = body.items[0] as unknown as Record<string, unknown>;
    for (const cle of ['id', 'title', 'slug', 'price', 'currency', 'countryCode', 'status', 'createdAt'] as const) {
      champ(item, cle, 'string');
    }
    for (const cle of ['minOrderQty', 'rating', 'ratingCount', 'stock'] as const) champ(item, cle, 'number');
    champ(item, 'inStock', 'boolean');
    champ(item, 'compareAtPrice', 'string', true);
    champ(item, 'image', 'string', true);
    champ(item, 'category', 'object', true);

    const store = item.store as Record<string, unknown>;
    for (const cle of ['id', 'name', 'slug', 'countryCode', 'verificationStatus', 'ratingAverage'] as const) {
      champ(store, cle, 'string');
    }
  });

  it('la fiche produit porte tout ce que le contrat promet', async () => {
    const res = await api.get(`/api/v1/products/${slug}`);
    assert.equal(res.status, 200);
    const produit = res.body as unknown as Record<string, unknown>;

    for (const cle of ['id', 'title', 'slug', 'description', 'price', 'currency', 'countryCode', 'status'] as const) {
      champ(produit, cle, 'string');
    }
    for (const cle of ['brand', 'sku', 'compareAtPrice'] as const) champ(produit, cle, 'string', true);
    champ(produit, 'weightGrams', 'number', true);
    for (const cle of ['images', 'variants', 'reviews'] as const) {
      assert.ok(Array.isArray(produit[cle]), `« ${cle} » est une liste`);
    }
    const store = produit.store as Record<string, unknown>;
    champ(store, 'city', 'string', true);
    champ(store, 'ratingCount', 'number');
  });

  it('le référentiel des pays est complet', async () => {
    const res = await api.get('/api/v1/countries');
    assert.equal(res.status, 200);
    const pays = (res.body.items as Country[]).map((c) => c as unknown as Record<string, unknown>);
    assert.ok(pays.length >= 2);
    for (const p of pays) {
      for (const cle of ['code', 'name', 'currency', 'dialCode'] as const) champ(p, cle, 'string');
      for (const cle of ['buyingEnabled', 'sellingEnabled', 'active'] as const) champ(p, cle, 'boolean');
    }
  });

  it('aucun montant n’arrive en nombre', async () => {
    // La règle qui justifie le type `MoneyString` du contrat : le serveur
    // calcule en décimal exact et transmet du texte. Un flottant ici, et toute
    // interface qui additionne se met à mentir de quelques centimes.
    const liste = await api.get('/api/v1/products?limit=5');
    for (const item of liste.body.items as Record<string, unknown>[]) {
      assert.equal(typeof item.price, 'string', 'le prix est une chaîne');
      assert.equal(typeof (item.store as Record<string, unknown>).ratingAverage, 'string');
      if (item.compareAtPrice !== null) assert.equal(typeof item.compareAtPrice, 'string');
    }

    const fiche = await api.get(`/api/v1/products/${slug}`);
    assert.equal(typeof fiche.body.price, 'string');
    for (const variante of fiche.body.variants as Record<string, unknown>[]) {
      assert.equal(typeof variante.price, 'string');
    }
  });

  it('une erreur a toujours la même forme', async () => {
    const res = await api.get('/api/v1/products/produit-qui-nexiste-pas');
    assert.equal(res.status, 404);
    champ(res.body as Record<string, unknown>, 'error', 'string');
  });
});
