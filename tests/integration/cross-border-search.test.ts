import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { corridorService } from '../../src/touma/trade/corridor.service.js';

/**
 * RECHERCHE TRANSFRONTALIÈRE (V24 §60).
 *
 * Trois pays se confondaient derrière un seul filtre : celui d'où part le
 * colis, celui où le vendeur est établi, celui d'où vient la marchandise. Ce
 * sont trois faits distincts, et un certificat d'origine établi sur le mauvais
 * est un document faux.
 *
 * Le filtre qui compte le plus est `deliverTo` — « montre-moi ce qui peut
 * réellement m'arriver ». Il ne doit jamais s'appuyer sur un corridor
 * *déclaré* actif : ces tests vérifient surtout cela.
 */
const api = new TestApi();
const suffixe = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let vendeurTd: any;
let produitTd: string;
let marque: string;

/**
 * Corridor d'essai, sur des pays qui n'appartiennent qu'à ce fichier.
 *
 * Tentant d'utiliser TD → CM : c'est le corridor pilote, il est parlant. Mais
 * le créer ici changerait l'état que d'autres fichiers de test lisent — une
 * suite qui vérifie que « le transfrontalier est fermé sur cette instance »
 * n'a pas à dépendre de l'ordre d'exécution. Deux pays neufs coûtent quatre
 * lignes et ne coûtent rien à personne.
 */
let paysA = '';
let paysB = '';
let produitA = '';
let slugCorridor = '';

/** Rend le corridor réellement opérationnel le temps d'un test. */
async function avecTransporteur<T>(action: () => Promise<T>): Promise<T> {
  const code = `essai-xb-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.toumaShippingProvider.create({
    data: { code, name: 'Transporteur d’essai', countries: `${paysA},${paysB}`, active: true },
  });
  try {
    return await action();
  } finally {
    await prisma.toumaShippingProvider.deleteMany({ where: { code } });
  }
}

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  marque = `xb${Date.now()}`;

  // Boutique camerounaise qui expédie depuis le Tchad : le cas exact que le
  // filtre unique rendait indistinguable.
  vendeurTd = await registerUser(api, { name: 'Vendeur XB', email: uniqueEmail(`xb-${suffixe()}`), role: 'SELLER', countryCode: 'CM' });
  const storeId = (await api.post('/api/v1/stores', { name: `Boutique XB ${suffixe()}`, countryCode: 'CM' }, vendeurTd.accessToken)).body.id;

  produitTd = (
    await api.post(
      '/api/v1/products',
      {
        storeId,
        title: `Gomme arabique ${marque}`,
        price: '52000',
        quantity: 10,
        status: 'ACTIVE',
        countryCode: 'TD',
        countryOfOrigin: 'TD',
        originEvidence: 'Mention du producteur sur le sac',
      },
      vendeurTd.accessToken,
    )
  ).body.id;

  const lettres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tirage = () => `X${lettres[Math.floor(Math.random() * 26)]}`;
  paysA = tirage();
  do paysB = tirage();
  while (paysB === paysA);

  for (const [code, role] of [[paysA, 'départ'], [paysB, 'arrivée']] as const) {
    await prisma.country.upsert({
      where: { code },
      update: { active: true },
      create: { code, name: `Pays d’essai ${code} (${role})`, currency: 'XAF', dialCode: '+000', active: true },
    });
  }
  await prisma.toumaTradeCorridor.deleteMany({ where: { OR: [{ originCountry: paysA }, { destinationCountry: paysB }] } });

  for (const code of [paysA, paysB]) {
    await corridorService.upsertCountryConfig(code, { tradeEnabled: true, paymentMethods: ['MOBILE_MONEY'], currencies: ['XAF'] });
  }
  const corridor = await corridorService.createCorridor({
    originCountry: paysA,
    destinationCountry: paysB,
    supportedCurrencies: ['XAF'],
    supportedPaymentMethods: ['MOBILE_MONEY'],
  });

  // Le corridor s'ouvre pendant qu'un transporteur réel le couvre — le refus
  // d'activation sans capacité réelle est vérifié ailleurs. Puis le
  // transporteur disparaît : il reste un corridor **déclaré actif** que plus
  // rien ne dessert. C'est l'état que §72 vise, et il arrive vraiment.
  await avecTransporteur(async () => {
    await corridorService.updateCorridor(corridor.id, { status: 'ACTIVE' });
  });
  slugCorridor = (await corridorService.byReference(corridor.code)).slug;

  const storeA = (await api.post('/api/v1/stores', { name: `Boutique A ${suffixe()}`, countryCode: paysA }, vendeurTd.accessToken)).body.id;
  produitA = (
    await api.post(
      '/api/v1/products',
      { storeId: storeA, title: `Natron ${marque}`, price: '9000', quantity: 4, status: 'ACTIVE', countryCode: paysA, countryOfOrigin: paysA },
      vendeurTd.accessToken,
    )
  ).body.id;
});
after(async () => {
  /**
   * Nettoyage des recherches laissées derrière soi.
   *
   * Chaque `GET /products?q=…` est journalisé pour mesurer la demande non
   * servie. Ce fichier en produit cinq sans résultat par exécution, toutes
   * sous le même terme — donc un terme de **volume 5**, là où une recherche
   * d'acheteur en vaut 1.
   *
   * Le tableau de bord d'intelligence borne sa liste à vingt termes, classés
   * par volume. Au bout de quelques dizaines d'exécutions, ces termes-ci
   * occupaient les vingt places et évinçaient ceux que le test
   * d'intelligence vérifie : il échouait sans que rien n'ait changé dans le
   * code qu'il teste.
   *
   * C'est la deuxième fois que des tests à moi salissent cet état partagé.
   * Le nettoyage ne coûte rien ; le diagnostic, lui, coûte cher.
   */
  // La journalisation est hors du chemin de réponse : une écriture lancée
  // juste avant ce nettoyage arriverait après lui. Le test d'intelligence
  // attend pour la même raison.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await prisma.toumaSearchQuery.deleteMany({ where: { term: { startsWith: marque } } });
  await api.stop();
});

describe('Déclaration d’origine', () => {
  it('l’origine déclarée par le vendeur n’est jamais enregistrée comme vérifiée', async () => {
    const res = await api.get(`/api/v1/products/${produitTd}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.origin.countryCode, 'TD');
    // §11 : tant que personne n'a vérifié, c'est DECLARED — jamais VERIFIED.
    assert.equal(res.body.origin.status, 'DECLARED');
    assert.equal(res.body.origin.evidence, 'Mention du producteur sur le sac');
    assert.ok(res.body.origin.declaredAt, 'la date de déclaration est conservée');
  });

  it('le pays d’expédition et le pays du vendeur restent deux faits distincts', async () => {
    const res = await api.get(`/api/v1/products/${produitTd}`);
    assert.equal(res.body.countryCode, 'TD', 'le colis part du Tchad');
    assert.equal(res.body.store.countryCode, 'CM', 'la boutique est camerounaise');
  });

  it('effacer l’origine ramène le statut à « inconnu » et retire la preuve', async () => {
    const res = await api.request('PATCH', `/api/v1/products/${produitTd}`, {
      token: vendeurTd.accessToken,
      body: { countryOfOrigin: null },
    });
    assert.equal(res.status, 200);
    const apres = await api.get(`/api/v1/products/${produitTd}`);
    assert.equal(apres.body.origin.countryCode, null);
    assert.equal(apres.body.origin.status, 'UNKNOWN');
    // Une justification qui survivrait à l'affirmation qu'elle appuyait
    // deviendrait une preuve orpheline.
    assert.equal(apres.body.origin.evidence, null);

    // Remise en place pour les tests suivants.
    await api.request('PATCH', `/api/v1/products/${produitTd}`, {
      token: vendeurTd.accessToken,
      body: { countryOfOrigin: 'TD', originEvidence: 'Mention du producteur sur le sac' },
    });
  });

  it('modifier un autre champ n’efface pas la déclaration', async () => {
    // Le formulaire vendeur envoie `null` pour un champ d'origine vide. Si une
    // modification de prix omettait les champs d'origine et que le serveur les
    // remettait à zéro, un vendeur perdrait sa déclaration sans rien demander
    // ni rien voir. Seul un champ **présent** dans la requête est touché.
    const res = await api.request('PATCH', `/api/v1/products/${produitTd}`, {
      token: vendeurTd.accessToken,
      body: { price: '53500' },
    });
    assert.equal(res.status, 200);
    const apres = await api.get(`/api/v1/products/${produitTd}`);
    assert.equal(apres.body.origin.countryCode, 'TD');
    assert.equal(apres.body.origin.status, 'DECLARED');
    assert.equal(apres.body.origin.evidence, 'Mention du producteur sur le sac');
  });

  it('un code pays inconnu du référentiel est refusé', async () => {
    const res = await api.request('PATCH', `/api/v1/products/${produitTd}`, {
      token: vendeurTd.accessToken,
      body: { countryOfOrigin: 'ZZ' },
    });
    assert.equal(res.status, 400);
  });
});

describe('Recherche par pays', () => {
  it('sépare pays d’expédition, pays du vendeur et pays d’origine', async () => {
    const parExpedition = await api.get(`/api/v1/products?q=${marque}&country=TD`);
    const parVendeur = await api.get(`/api/v1/products?q=${marque}&sellerCountry=CM`);
    const parOrigine = await api.get(`/api/v1/products?q=${marque}&originCountry=TD`);
    for (const [nom, res] of [['expédition', parExpedition], ['vendeur', parVendeur], ['origine', parOrigine]] as const) {
      assert.ok(res.body.items.some((p: any) => p.id === produitTd), `le produit est trouvé par ${nom}`);
    }

    // Et les combinaisons fausses ne le trouvent pas.
    const faux = await api.get(`/api/v1/products?q=${marque}&sellerCountry=TD`);
    assert.equal(faux.body.items.length, 0, 'la boutique n’est pas tchadienne');
  });

  it('un produit sans origine déclarée n’est rangé sous aucun pays d’origine', async () => {
    const storeId = (await api.post('/api/v1/stores', { name: `Sans origine ${suffixe()}`, countryCode: 'TD' }, vendeurTd.accessToken)).body.id;
    const sansOrigine = (
      await api.post('/api/v1/products', { storeId, title: `Sel gemme ${marque}`, price: '3000', quantity: 5, status: 'ACTIVE', countryCode: 'TD' }, vendeurTd.accessToken)
    ).body.id;

    const res = await api.get(`/api/v1/products?q=${marque}&originCountry=TD`);
    // Un produit sur lequel on ne sait rien n'est pas un produit d'origine
    // tchadienne : l'absence de déclaration ne se déduit pas du pays d'envoi.
    assert.ok(!res.body.items.some((p: any) => p.id === sansOrigine));
    assert.ok(res.body.items.some((p: any) => p.id === produitTd));
  });
});

describe('« Ce qui peut réellement m’arriver »', () => {
  it('le corridor est bien déclaré actif : le piège est réel', async () => {
    const capacite = await corridorService.capability(paysA, paysB);
    assert.equal(capacite.declaredStatus, 'ACTIVE', 'l’exploitant a déclaré ce corridor ouvert');
    assert.equal(capacite.operational, false, 'et pourtant plus rien ne le dessert');
  });

  it('le commerce national passe toujours, sans dépendre d’un corridor', async () => {
    // §73 : le commerce national doit continuer à fonctionner normalement.
    const res = await api.get(`/api/v1/products?q=${marque}&deliverTo=${paysA}`);
    assert.ok(res.body.items.some((p: any) => p.id === produitA));
  });

  it('un corridor déclaré actif mais non desservi ne rend rien livrable', async () => {
    const res = await api.get(`/api/v1/products?q=${marque}&deliverTo=${paysB}`);
    assert.ok(
      !res.body.items.some((p: any) => p.id === produitA),
      'le statut déclaré ne suffit pas à promettre une livraison',
    );
  });

  it('devient livrable dès qu’un transporteur réel couvre le corridor', async () => {
    await avecTransporteur(async () => {
      assert.equal((await corridorService.capability(paysA, paysB)).operational, true);
      const res = await api.get(`/api/v1/products?q=${marque}&deliverTo=${paysB}`);
      assert.ok(res.body.items.some((p: any) => p.id === produitA), 'livrable une fois le corridor réellement couvert');
    });
  });

  it('et cesse de l’être quand le transporteur disparaît', async () => {
    // Rien n'est mis en cache côté produit : la capacité est recalculée à
    // chaque lecture, donc la promesse se retire avec le transporteur.
    const res = await api.get(`/api/v1/products?q=${marque}&deliverTo=${paysB}`);
    assert.ok(!res.body.items.some((p: any) => p.id === produitA));
  });

  it('les compteurs de facettes portent la même restriction que la liste', async () => {
    await avecTransporteur(async () => {
      const liste = await api.get(`/api/v1/products?q=${marque}&deliverTo=${paysB}`);
      const facettes = await api.get(`/api/v1/products/facets?q=${marque}&deliverTo=${paysB}`);
      const total = facettes.body.countries.reduce((acc: number, c: any) => acc + c.count, 0);
      // Des facettes calculées sans la restriction annonceraient « Pays A (12) »
      // au-dessus d'une liste vide.
      assert.ok(liste.body.total > 0, 'la liste n’est pas vide : la comparaison a du sens');
      assert.equal(total, liste.body.total);
    });
  });
});

describe('Recherche par corridor', () => {
  it('un corridor ne retient que les produits expédiés de son pays de départ', async () => {
    await avecTransporteur(async () => {
      const res = await api.get(`/api/v1/products?q=${marque}&corridor=${slugCorridor}`);
      assert.ok(res.body.items.some((p: any) => p.id === produitA));
      for (const p of res.body.items) assert.equal(p.countryCode, paysA);
      // Le produit expédié du Tchad n'a rien à faire sur ce corridor.
      assert.ok(!res.body.items.some((p: any) => p.id === produitTd));
    });
  });

  it('un corridor non desservi ne rend aucun produit, même déclaré actif', async () => {
    const res = await api.get(`/api/v1/products?q=${marque}&corridor=${slugCorridor}`);
    assert.equal(res.body.total, 0);
  });

  it('une adresse de corridor inconnue vide la recherche au lieu de l’élargir', async () => {
    const res = await api.get(`/api/v1/products?q=${marque}&corridor=pays-imaginaire-autre-pays`);
    // Ignorer un filtre incompris rendrait des résultats que personne n'a
    // demandés, sans que rien ne le signale.
    assert.equal(res.body.items.length, 0);
    assert.equal(res.body.total, 0);
  });
});
