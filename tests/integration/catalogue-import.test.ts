import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Import et export de catalogue.
 *
 * Un grossiste avec deux cents références ne les saisira pas une par une : sans
 * import, son catalogue ne monte jamais en ligne. Ces tests vérifient surtout
 * ce qui protège son travail : rien n'est écrit avant qu'il ait vu le
 * diagnostic, et une ligne fautive n'emporte pas les autres.
 */
const api = new TestApi();

let seller: any;
let other: any;
let storeId: string;

/** Envoi du CSV brut, comme le ferait un collage depuis un tableur. */
function importCsv(csv: string, { dryRun }: { dryRun: boolean }, token: string) {
  return api.request('POST', `/api/v1/seller/stores/${storeId}/catalogue/import?dryRun=${dryRun}`, {
    raw: Buffer.from(csv, 'utf8'),
    headers: { 'content-type': 'text/csv' },
    token,
  });
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  seller = await registerUser(api, { name: 'Vendeur import', email: uniqueEmail('im-seller'), role: 'SELLER', countryCode: 'CM' });
  storeId = (await api.post('/api/v1/stores', { name: `Boutique import ${Date.now()}`, countryCode: 'CM' }, seller.accessToken)).body.id;
  other = await registerUser(api, { name: 'Vendeur tiers', email: uniqueEmail('im-other'), role: 'SELLER', countryCode: 'TD' });
});
after(async () => api.stop());

describe('Import de catalogue', () => {
  const sku = `IMP-${Date.now()}`;

  it('simule sans rien écrire', async () => {
    const before = await prisma.toumaProduct.count({ where: { storeId } });
    const res = await importCsv(
      `sku;titre;prix;stock;statut\n${sku};Cacao en fèves;145000;40;ACTIVE`,
      { dryRun: true },
      seller.accessToken,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.summary.toCreate, 1);
    assert.equal(res.body.summary.errors, 0);
    assert.equal(await prisma.toumaProduct.count({ where: { storeId } }), before, 'la simulation n’écrit rien');
  });

  it('crée les produits une fois l’import confirmé', async () => {
    const res = await importCsv(
      `sku;titre;prix;stock;quantite_minimale;poids_grammes;statut\n${sku};Cacao en fèves;145000;40;5;50000;ACTIVE`,
      { dryRun: false },
      seller.accessToken,
    );
    assert.equal(res.body.summary.created, 1);

    const product = await prisma.toumaProduct.findFirstOrThrow({ where: { storeId, sku }, include: { inventory: true } });
    assert.equal(product.title, 'Cacao en fèves');
    assert.equal(product.price.toString(), '145000');
    assert.equal(product.status, 'ACTIVE');
    assert.equal(product.minOrderQty, 5);
    assert.equal(product.weightGrams, 50000);
    assert.equal(product.inventory[0].quantity, 40);
    // La devise vient du pays de la boutique, jamais du fichier.
    assert.equal(product.currency, 'XAF');
  });

  it('met à jour par référence, sans créer de doublon', async () => {
    const res = await importCsv(
      `sku;titre;prix;stock\n${sku};Cacao en fèves — récolte 2026;150000;25`,
      { dryRun: false },
      seller.accessToken,
    );
    assert.equal(res.body.summary.updated, 1);
    assert.equal(res.body.summary.created, 0);

    const products = await prisma.toumaProduct.findMany({ where: { storeId, sku }, include: { inventory: true } });
    assert.equal(products.length, 1, 'une seule fiche pour cette référence');
    assert.equal(products[0].price.toString(), '150000');
    // L'inventaire du vendeur fait foi : le stock est remplacé, pas additionné.
    assert.equal(products[0].inventory[0].quantity, 25);
  });

  it('rejette les lignes fautives sans emporter les bonnes', async () => {
    const good = `OK-${Date.now()}`;
    const res = await importCsv(
      [
        'sku;titre;prix;stock',
        `${good};Sésame blanc;38000;100`,
        ';;;', // ligne vide : ignorée par l'analyseur
        'X1;;12000;10', // titre manquant
        'X2;Miel;pas un prix;10', // prix illisible
        'X3;Karité;-5;10', // prix négatif
        'X4;Gingembre;1000;2,5', // stock non entier
      ].join('\n'),
      { dryRun: false },
      seller.accessToken,
    );
    assert.equal(res.body.summary.created, 1, 'la ligne valide est bien créée');
    assert.equal(res.body.summary.errors, 4);
    assert.ok(await prisma.toumaProduct.findFirst({ where: { storeId, sku: good } }));

    // Chaque erreur porte son numéro de ligne, tel que le vendeur le voit.
    const errors = res.body.results.filter((r: any) => r.action === 'error');
    assert.ok(errors.every((e: any) => typeof e.line === 'number' && e.message));
    assert.ok(errors.some((e: any) => /titre/i.test(e.message)));
    assert.ok(errors.some((e: any) => /prix/i.test(e.message)));
  });

  it('refuse une référence présente deux fois dans le même fichier', async () => {
    const dup = `DUP-${Date.now()}`;
    const res = await importCsv(
      `sku;titre;prix;stock\n${dup};Version A;1000;5\n${dup};Version B;2000;5`,
      { dryRun: true },
      seller.accessToken,
    );
    assert.equal(res.body.summary.errors, 1);
    assert.match(res.body.results.find((r: any) => r.action === 'error').message, /deux fois/i);
  });

  it('refuse une devise étrangère à la boutique', async () => {
    const res = await importCsv(
      `sku;titre;prix;devise;stock\nEUR-1;Produit;1000;EUR;5`,
      { dryRun: true },
      seller.accessToken,
    );
    assert.equal(res.body.summary.errors, 1);
    assert.match(res.body.results[0].message, /devise/i);
  });

  it('refuse une catégorie inconnue', async () => {
    const res = await importCsv(
      `sku;titre;prix;categorie;stock\nCAT-1;Produit;1000;categorie-qui-nexiste-pas;5`,
      { dryRun: true },
      seller.accessToken,
    );
    assert.equal(res.body.summary.errors, 1);
    assert.match(res.body.results[0].message, /catégorie/i);
  });

  it('accepte les en-têtes anglais, les accents et les nombres à la française', async () => {
    const ref = `EN-${Date.now()}`;
    const res = await importCsv(
      `SKU,Title,Price,Stock,Statut\n${ref},"Shea butter, raw","12 500,50",7,ACTIVE`,
      { dryRun: false },
      seller.accessToken,
    );
    assert.equal(res.body.summary.created, 1, JSON.stringify(res.body.results));
    const product = await prisma.toumaProduct.findFirstOrThrow({ where: { storeId, sku: ref } });
    assert.equal(product.title, 'Shea butter, raw');
    assert.equal(product.price.toString(), '12500.5');
  });

  it('refuse un fichier vide ou sans en-têtes exploitables', async () => {
    const res = await importCsv('', { dryRun: true }, seller.accessToken);
    assert.equal(res.status, 400);
  });

  it('interdit d’importer dans la boutique d’autrui', async () => {
    const res = await importCsv(`sku;titre;prix;stock\nX;Produit;1000;1`, { dryRun: true }, other.accessToken);
    assert.equal(res.status, 404);
  });
});

describe('Export de catalogue', () => {
  it('exporte au format attendu par l’import, et se réimporte', async () => {
    const res = await api.get(`/api/v1/seller/stores/${storeId}/catalogue/export`, seller.accessToken);
    assert.equal(res.status, 200);
    const csv = typeof res.body === 'string' ? res.body : String(res.body);
    assert.ok(csv.includes('sku;titre;description'), 'les en-têtes sont ceux de l’import');

    // Aller-retour : réimporter l'export ne doit produire que des mises à jour.
    const back = await importCsv(csv, { dryRun: true }, seller.accessToken);
    assert.equal(back.body.summary.errors, 0, JSON.stringify(back.body.results.filter((r: any) => r.action === 'error')));
    assert.equal(back.body.summary.toCreate, 0, 'aucun produit dupliqué par l’aller-retour');
    assert.ok(back.body.summary.toUpdate > 0);
  });

  it('fournit un modèle vierge exploitable', async () => {
    const res = await api.get('/api/v1/seller/catalogue/modele', seller.accessToken);
    assert.equal(res.status, 200);
    const csv = typeof res.body === 'string' ? res.body : String(res.body);
    const preview = await importCsv(csv, { dryRun: true }, seller.accessToken);
    assert.equal(preview.body.summary.errors, 0, 'le modèle fourni passe la validation');
  });

  it('interdit d’exporter la boutique d’autrui', async () => {
    assert.equal((await api.get(`/api/v1/seller/stores/${storeId}/catalogue/export`, other.accessToken)).status, 404);
  });
});
