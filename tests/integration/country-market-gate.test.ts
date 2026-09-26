import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Le statut d'un marché gouverne le passage de commande (V26 §33).
 *
 * **Le défaut fermé ici.** Le contrôle de livraison ne regardait que
 * `country.buyingEnabled`. Un pays en configuration garde souvent cet
 * interrupteur à vrai par héritage — le Cameroun était exactement dans ce cas.
 * Une commande vers une adresse camerounaise passait donc, alors qu'aucun
 * transporteur réel ne dessert le pays : une promesse de livraison que
 * personne ne pouvait tenir.
 */
const api = new TestApi();

let vendeur: any;
let acheteur: any;
let boutiqueId: string;

/** Un marché dont on maîtrise le statut, le temps du test. */
const MARCHE = 'QZ';

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  vendeur = await registerUser(api, { name: 'Vendeur', email: uniqueEmail(`v-${s}`), role: 'SELLER', countryCode: 'TD' });
  acheteur = await registerUser(api, { name: 'Acheteur', email: uniqueEmail(`a-${s}`), role: 'BUYER', countryCode: 'TD' });

  boutiqueId = (
    await api.post('/api/v1/stores', { name: `Boutique ${s}`, countryCode: 'TD', city: 'N’Djamena' }, vendeur.accessToken)
  ).body.id;
});

after(async () => {
  await prisma.toumaAddress.deleteMany({ where: { countryCode: MARCHE } });
  await prisma.country.deleteMany({ where: { code: MARCHE } });
  await api.stop();
});

/** Pose le marché d'essai dans un statut donné, achat ouvert côté interrupteur. */
async function marcheEn(status: 'CONFIGURING' | 'PILOT') {
  const donnees = {
    name: 'Marché d’essai',
    currency: 'XAF',
    dialCode: '+000',
    timezone: 'Africa/Ndjamena',
    status,
    active: true,
    // L'interrupteur dit oui. C'est tout l'intérêt : si le statut n'était pas
    // consulté, la commande passerait.
    buyingEnabled: true,
    sellingEnabled: true,
  };
  await prisma.country.upsert({ where: { code: MARCHE }, update: donnees, create: { code: MARCHE, ...donnees } });
}

/** Une adresse de livraison de l'acheteur, dans le marché d'essai. */
async function adresseDansLeMarche(): Promise<string> {
  const existante = await prisma.toumaAddress.findFirst({ where: { userId: acheteur.user.id, countryCode: MARCHE } });
  if (existante) return existante.id;
  const creee = await prisma.toumaAddress.create({
    data: {
      userId: acheteur.user.id,
      fullName: 'Destinataire d’essai',
      phone: '+23566000000',
      line1: 'Rue d’essai',
      city: 'Ville d’essai',
      countryCode: MARCHE,
    },
  });
  return creee.id;
}

/** Remplit le panier de l'acheteur avec un article disponible. */
async function panierGarni() {
  const produit = (
    await api.post(
      '/api/v1/products',
      { storeId: boutiqueId, title: `Article ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, price: '15000', quantity: 20, weightGrams: 800, status: 'ACTIVE' },
      vendeur.accessToken,
    )
  ).body.id;
  const ajout = await api.post('/api/v1/cart/items', { productId: produit, quantity: 1 }, acheteur.accessToken);
  assert.equal(ajout.status, 201, `panier : ${JSON.stringify(ajout.body)}`);
}

describe('Marché en configuration — la commande ne passe pas', () => {
  it('refuse la livraison, et le dit en nommant le pays', async () => {
    await marcheEn('CONFIGURING');
    await panierGarni();

    const res = await api.post(
      '/api/v1/checkout',
      { addressId: await adresseDansLeMarche(), deliveryMethod: 'HOME' },
      acheteur.accessToken,
    );

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /Livraison non disponible/);
    assert.match(String(res.body.error), new RegExp(MARCHE));

    // Aucune commande n'a été créée : un refus ne laisse pas de trace à demi.
    const adresses = await prisma.toumaAddress.findMany({ where: { countryCode: MARCHE }, select: { id: true } });
    assert.equal(await prisma.toumaOrder.count({ where: { shippingAddressId: { in: adresses.map((a) => a.id) } } }), 0);
  });

  it('laisse passer le même panier dès que le marché est en pilote', async () => {
    // La preuve que c'est bien le statut qui décidait, et rien d'autre : seule
    // cette ligne change entre les deux essais.
    await marcheEn('PILOT');

    const res = await api.post(
      '/api/v1/checkout',
      { addressId: await adresseDansLeMarche(), deliveryMethod: 'HOME' },
      acheteur.accessToken,
    );

    // Le contrôle pays est franchi. La suite du parcours peut échouer pour
    // d'autres raisons — c'est un marché sans transporteur — mais plus pour
    // celle-là, et c'est ce que ce test établit.
    assert.doesNotMatch(String(res.body?.error ?? ''), /Livraison non disponible/);
  });
});
