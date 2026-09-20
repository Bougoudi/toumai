import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { promotionService, type PromotionContext } from '../../src/touma/growth/promotion.service.js';
import { recordPrice, referencePrice, savings } from '../../src/touma/growth/price-history.js';

const api = new TestApi();
const D = (n: number | string) => new Prisma.Decimal(n);

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
});
after(async () => api.stop());

async function boutique(suffixe: string) {
  const vendeur = await registerUser(api, {
    name: `Vendeur ${suffixe}`,
    email: uniqueEmail(`growth-${suffixe}`),
    role: 'SELLER',
  });
  const store = await prisma.toumaStore.create({
    data: {
      ownerId: vendeur.user.id,
      name: `Boutique ${suffixe}`,
      slug: `boutique-growth-${suffixe}-${Date.now()}`,
      countryCode: 'TD',
      status: 'ACTIVE',
    },
  });
  return { vendeur, store };
}

async function produit(storeId: string, suffixe: string, prix = '25000') {
  const categorie = await prisma.toumaCategory.findFirstOrThrow();
  return prisma.toumaProduct.create({
    data: {
      storeId,
      categoryId: categorie.id,
      title: `Produit ${suffixe}`,
      slug: `p-growth-${suffixe}-${Date.now()}`,
      description: 'Test',
      price: prix,
      currency: 'XAF',
      countryCode: 'TD',
      status: 'ACTIVE',
    },
  });
}

const contexte = (storeId: string, productId: string, categoryId: string, over: Partial<PromotionContext> = {}): PromotionContext => ({
  userId: 'u',
  lines: [{ storeId, subtotal: D(30_000), shipping: D(2_000), productIds: [productId], categoryIds: [categoryId], quantity: 2 }],
  currency: 'XAF',
  destinationCountry: 'TD',
  destinationProvinceId: null,
  previousOrders: 3,
  segments: ['ACTIVE'],
  ...over,
});

describe('Promotions automatiques', () => {
  it('applique une remise quand les conditions sont remplies, et dit ce qu’elle coûte à qui', async () => {
    const { store } = await boutique('applique');
    const p = await produit(store.id, 'applique');
    const promo = await prisma.toumaPromotion.create({
      data: {
        name: 'Dix pour cent',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '10',
        rules: { create: [{ kind: 'MIN_ORDER_AMOUNT', threshold: '25000' }] },
      },
    });

    const r = await promotionService.evaluateCart(contexte(store.id, p.id, p.categoryId!));
    assert.equal(r.applied.length, 1);
    assert.equal(r.applied[0].promotionId, promo.id);
    assert.equal(r.applied[0].amount.toString(), '3000', '10 % de 30 000');
    // Qui finance : sans cela, le règlement du vendeur serait faux.
    assert.equal(r.applied[0].funding, 'SELLER');
    assert.equal(r.merchandiseDiscount.toString(), '3000');
  });

  it('dit pourquoi une promotion ne s’applique pas', async () => {
    // Un acheteur qui voit « −10 % dès 50 000 » et ne l'obtient pas doit savoir
    // ce qui lui manque, pas croire à une panne.
    const { store } = await boutique('refus');
    const p = await produit(store.id, 'refus');
    await prisma.toumaPromotion.create({
      data: {
        name: 'Gros panier',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '10',
        rules: { create: [{ kind: 'MIN_ORDER_AMOUNT', threshold: '50000' }] },
      },
    });
    const r = await promotionService.evaluateCart(contexte(store.id, p.id, p.categoryId!));
    assert.equal(r.applied.length, 0);
    assert.equal(r.rejected.length, 1);
    assert.ok(r.rejected[0].reasons.includes('promo.fail.minOrderAmount'));
  });

  it('ne laisse pas la promotion d’une boutique réduire une autre boutique', async () => {
    // Le défaut le plus coûteux du module : un vendeur qui paie la remise d'un
    // autre.
    const a = await boutique('bout-a');
    const b = await boutique('bout-b');
    const pa = await produit(a.store.id, 'pa');
    const pb = await produit(b.store.id, 'pb');
    await prisma.toumaPromotion.create({
      data: {
        name: 'Promo A',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: a.store.id,
        funding: 'SELLER',
        value: '10',
      },
    });

    const r = await promotionService.evaluateCart({
      userId: 'u',
      lines: [
        { storeId: a.store.id, subtotal: D(10_000), shipping: D(0), productIds: [pa.id], categoryIds: [pa.categoryId!], quantity: 1 },
        { storeId: b.store.id, subtotal: D(90_000), shipping: D(0), productIds: [pb.id], categoryIds: [pb.categoryId!], quantity: 1 },
      ],
      currency: 'XAF',
      destinationCountry: 'TD',
      destinationProvinceId: null,
      previousOrders: 3,
      segments: [],
    });
    assert.equal(r.applied.length, 1);
    // 10 % de 10 000, pas de 100 000.
    assert.equal(r.applied[0].amount.toString(), '1000');
    assert.equal(r.applied[0].byStore.get(b.store.id), undefined, 'la boutique B ne finance rien');
  });

  it('ne convertit jamais une remise fixe dans une autre devise', async () => {
    const { store } = await boutique('devise');
    const p = await produit(store.id, 'devise');
    await prisma.toumaPromotion.create({
      data: {
        name: 'Mille euros',
        type: 'FIXED_AMOUNT',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '1000',
        currency: 'EUR',
      },
    });
    const r = await promotionService.evaluateCart(contexte(store.id, p.id, p.categoryId!));
    assert.equal(r.applied.length, 0, 'convertir sans taux officiel serait inventer un prix');
  });

  it('ignore une promotion expirée ou non démarrée', async () => {
    const { store } = await boutique('dates');
    const p = await produit(store.id, 'dates');
    await prisma.toumaPromotion.createMany({
      data: [
        { name: 'Finie', type: 'PERCENTAGE', status: 'ACTIVE', storeId: store.id, funding: 'SELLER', value: '50', endsAt: new Date(Date.now() - 86_400_000) },
        { name: 'Future', type: 'PERCENTAGE', status: 'ACTIVE', storeId: store.id, funding: 'SELLER', value: '50', startsAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    const r = await promotionService.evaluateCart(contexte(store.id, p.id, p.categoryId!));
    assert.equal(r.applied.length, 0);
  });
});

describe('Budget d’une promotion', () => {
  it('arrête la promotion quand l’enveloppe est atteinte, sans la dépasser', async () => {
    const { store } = await boutique('budget');
    const acheteur = await registerUser(api, { name: 'Acheteur B', email: uniqueEmail('growth-budget'), role: 'BUYER' });
    const promo = await prisma.toumaPromotion.create({
      data: {
        name: 'Budget serré',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '10',
        budget: { create: { total: '10000', currency: 'XAF' } },
      },
    });

    const ok1 = await promotionService.consume(promo.id, acheteur.user.id, null, D(6_000), 'XAF');
    const ok2 = await promotionService.consume(promo.id, acheteur.user.id, null, D(6_000), 'XAF');
    assert.equal(ok1, true);
    assert.equal(ok2, false, 'la seconde dépense ferait déborder l’enveloppe');

    const budget = await prisma.toumaPromotionBudget.findUniqueOrThrow({ where: { promotionId: promo.id } });
    assert.equal(budget.spent.toString(), '6000', 'rien n’est dépensé au-delà');

    // La promotion est suspendue : le prochain panier ne la propose même plus.
    const apres = await prisma.toumaPromotion.findUniqueOrThrow({ where: { id: promo.id } });
    assert.equal(apres.status, 'PAUSED');
  });

  it('ne dépasse pas l’enveloppe sous consommation concurrente', async () => {
    // Le cas qui coûte de l'argent : dix commandes simultanées sur un budget
    // qui n'en permet que quatre. Une lecture-puis-écriture les laisserait
    // toutes passer.
    const { store } = await boutique('concurrent');
    const acheteur = await registerUser(api, { name: 'Acheteur C', email: uniqueEmail('growth-conc'), role: 'BUYER' });
    const promo = await prisma.toumaPromotion.create({
      data: {
        name: 'Concurrence',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '10',
        budget: { create: { total: '4000', currency: 'XAF' } },
      },
    });

    const resultats = await Promise.all(
      Array.from({ length: 10 }, () => promotionService.consume(promo.id, acheteur.user.id, null, D(1_000), 'XAF')),
    );
    const acceptes = resultats.filter(Boolean).length;
    assert.equal(acceptes, 4, `4 dépenses attendues, ${acceptes} acceptées`);

    const budget = await prisma.toumaPromotionBudget.findUniqueOrThrow({ where: { promotionId: promo.id } });
    assert.equal(budget.spent.toString(), '4000', 'l’enveloppe n’est jamais dépassée');

    const usages = await prisma.toumaPromotionUsage.count({ where: { promotionId: promo.id } });
    assert.equal(usages, 4, 'autant d’usages consignés que de dépenses acceptées');
  });

  it('refuse une dépense dans une autre devise que le budget', async () => {
    const { store } = await boutique('budget-devise');
    const acheteur = await registerUser(api, { name: 'Acheteur D', email: uniqueEmail('growth-bd'), role: 'BUYER' });
    const promo = await prisma.toumaPromotion.create({
      data: {
        name: 'Devise',
        type: 'PERCENTAGE',
        status: 'ACTIVE',
        storeId: store.id,
        funding: 'SELLER',
        value: '10',
        budget: { create: { total: '10000', currency: 'XAF' } },
      },
    });
    assert.equal(await promotionService.consume(promo.id, acheteur.user.id, null, D(100), 'EUR'), false);
  });
});

describe('Intégrité des prix', () => {
  it('n’affiche aucun prix barré sans historique', async () => {
    const { store } = await boutique('prix-vide');
    const p = await produit(store.id, 'prix-vide', '20000');
    const ref = await referencePrice(p.id, '20000', 'XAF');
    assert.equal(ref.amount, null);
    assert.equal(savings(ref, '20000'), null, 'ne rien afficher plutôt qu’afficher zéro');
  });

  it('refuse un prix de référence qui n’a pas tenu assez longtemps', async () => {
    // Sans cette règle, il suffirait de monter un prix une heure pour annoncer
    // une remise le lendemain.
    const { store } = await boutique('prix-court');
    const p = await produit(store.id, 'prix-court', '20000');
    await recordPrice({ productId: p.id, price: '25000', currency: 'XAF' });
    await recordPrice({ productId: p.id, price: '20000', currency: 'XAF' });

    const ref = await referencePrice(p.id, '20000', 'XAF');
    assert.equal(ref.amount, null, '25 000 n’a tenu que quelques millisecondes');
  });

  it('accepte un prix réellement pratiqué assez longtemps, et dit depuis quand', async () => {
    const { store } = await boutique('prix-long');
    const p = await produit(store.id, 'prix-long', '20000');
    const ilYA60Jours = new Date(Date.now() - 60 * 86_400_000);
    const ilYA5Jours = new Date(Date.now() - 5 * 86_400_000);
    await prisma.toumaProductPriceHistory.createMany({
      data: [
        { productId: p.id, price: '25000', currency: 'XAF', validFrom: ilYA60Jours, validTo: ilYA5Jours },
        { productId: p.id, price: '20000', currency: 'XAF', validFrom: ilYA5Jours },
      ],
    });

    const ref = await referencePrice(p.id, '20000', 'XAF');
    assert.equal(ref.amount?.toString(), '25000');
    assert.ok((ref.heldDays ?? 0) >= 30, 'et on sait combien de temps il a tenu');
    assert.ok(ref.since instanceof Date, 'et depuis quand — ce qui rend l’affirmation vérifiable');
    assert.equal(savings(ref, '20000')?.toString(), '5000');
  });

  it('ne compare jamais deux devises', async () => {
    const { store } = await boutique('prix-devise');
    const p = await produit(store.id, 'prix-devise', '20000');
    const ilYA60Jours = new Date(Date.now() - 60 * 86_400_000);
    await prisma.toumaProductPriceHistory.create({
      data: { productId: p.id, price: '40', currency: 'EUR', validFrom: ilYA60Jours },
    });
    const ref = await referencePrice(p.id, '20000', 'XAF');
    assert.equal(ref.amount, null);
  });

  it('n’écrit pas de ligne quand le prix ne change pas', async () => {
    const { store } = await boutique('prix-idem');
    const p = await produit(store.id, 'prix-idem', '20000');
    await recordPrice({ productId: p.id, price: '20000', currency: 'XAF' });
    await recordPrice({ productId: p.id, price: '20000', currency: 'XAF' });
    await recordPrice({ productId: p.id, price: '20000', currency: 'XAF' });
    const lignes = await prisma.toumaProductPriceHistory.count({ where: { productId: p.id } });
    assert.equal(lignes, 1, 'une histoire lisible, pas une ligne par enregistrement du formulaire');
  });

  it('clôt le prix précédent en ouvrant le suivant', async () => {
    const { store } = await boutique('prix-suite');
    const p = await produit(store.id, 'prix-suite', '20000');
    await recordPrice({ productId: p.id, price: '25000', currency: 'XAF' });
    await recordPrice({ productId: p.id, price: '20000', currency: 'XAF' });
    const lignes = await prisma.toumaProductPriceHistory.findMany({
      where: { productId: p.id },
      orderBy: { validFrom: 'asc' },
    });
    assert.equal(lignes.length, 2);
    assert.ok(lignes[0].validTo instanceof Date, 'le prix précédent est clos');
    assert.equal(lignes[1].validTo, null, 'le prix courant reste ouvert');
  });
});

describe('Fiche produit — pas de prix barré inventé', () => {
  it('n’affiche pas le prix barré déclaré par le vendeur', async () => {
    // Le défaut que ceci corrige : `compareAtPrice` est saisi librement par le
    // vendeur — et l'import CSV accepte une colonne « prix_barre », donc
    // n'importe quel chiffre pouvait entrer en masse. La fiche publique ne le
    // barre plus sans preuve.
    const { store } = await boutique('fiche-faux');
    const categorie = await prisma.toumaCategory.findFirstOrThrow();
    const p = await prisma.toumaProduct.create({
      data: {
        storeId: store.id,
        categoryId: categorie.id,
        title: 'Produit prix barré',
        slug: `p-barre-${Date.now()}`,
        description: 'Test',
        price: '20000',
        // Un prix jamais pratiqué, déclaré par le vendeur.
        compareAtPrice: '99000',
        currency: 'XAF',
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });

    const res = await api.get(`/api/v1/products/${p.slug}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.referencePrice, null, 'aucun prix barré sans historique qui le justifie');
    assert.equal(res.body.savings, null, 'et donc aucune économie annoncée');
    // Le chiffre déclaré reste lisible pour le vendeur, mais il n'est plus
    // celui que la fiche barre.
    assert.equal(res.body.compareAtPrice, '99000');
  });

  it('affiche un prix barré quand l’historique le prouve', async () => {
    const { store } = await boutique('fiche-vrai');
    const categorie = await prisma.toumaCategory.findFirstOrThrow();
    const p = await prisma.toumaProduct.create({
      data: {
        storeId: store.id,
        categoryId: categorie.id,
        title: 'Produit vraie remise',
        slug: `p-vrai-${Date.now()}`,
        description: 'Test',
        price: '20000',
        currency: 'XAF',
        countryCode: 'TD',
        status: 'ACTIVE',
      },
    });
    const ilYA90Jours = new Date(Date.now() - 90 * 86_400_000);
    const ilYA2Jours = new Date(Date.now() - 2 * 86_400_000);
    await prisma.toumaProductPriceHistory.createMany({
      data: [
        { productId: p.id, price: '25000', currency: 'XAF', validFrom: ilYA90Jours, validTo: ilYA2Jours },
        { productId: p.id, price: '20000', currency: 'XAF', validFrom: ilYA2Jours },
      ],
    });

    const res = await api.get(`/api/v1/products/${p.slug}`);
    assert.equal(res.body.referencePrice.amount, '25000');
    assert.equal(res.body.savings, '5000');
    assert.ok(res.body.referencePrice.heldDays >= 30, 'et on dit combien de temps il a tenu');
  });

  it('consigne le prix dès la création du produit', async () => {
    const { store, vendeur } = await boutique('fiche-hist');
    const categorie = await prisma.toumaCategory.findFirstOrThrow();
    const res = await api.post(
      '/api/v1/products',
      {
        storeId: store.id,
        categoryId: categorie.id,
        title: `Produit historique ${Date.now()}`,
        description: 'Description suffisamment longue pour passer la validation.',
        price: '15000',
        currency: 'XAF',
        countryCode: 'TD',
        quantity: 10,
        status: 'ACTIVE',
      },
      vendeur.accessToken,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const lignes = await prisma.toumaProductPriceHistory.findMany({ where: { productId: res.body.id } });
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].price.toString(), '15000');
    assert.equal(lignes[0].validTo, null, 'le prix courant reste ouvert');
  });
});
