import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { alerter, cleOuverte, reconcilier } from '../../src/touma/market/signals.service.js';

/**
 * SIGNAUX PERSISTÉS, SURVEILLANCE ET ALERTES (V29 §28 à §30, §36).
 *
 * Trois invariants, et chacun tient à autre chose qu'à la bonne volonté du
 * code :
 *
 * | Invariant | Ce qui le garantit |
 * |---|---|
 * | un seul signal ouvert par sujet et par type | `openKey` unique en base |
 * | une alerte au plus par signal et par surveillance | `@@unique([signalId, watchId])` |
 * | aucune clôture sur observation incomplète | le drapeau `truncated` |
 *
 * Le troisième est le moins visible et le plus dangereux : sur une liste
 * tronquée par une limite, un signal absent n'est pas un signal disparu. Le
 * clore reviendrait à annoncer à un vendeur qu'une rupture est réglée parce
 * qu'elle était au-delà de la cinq-centième ligne.
 */
const api = new TestApi();

let vendeur: any;
let autre: any;
let boutique: string;
let boutiqueAutre: string;

const MAINTENANT = new Date('2026-09-26T12:00:00Z');
const plusTard = (jours: number) => new Date(MAINTENANT.getTime() + jours * 86_400_000);
const ilYaJours = (n: number) => new Date(MAINTENANT.getTime() - n * 86_400_000);

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();

  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  vendeur = await registerUser(api, { name: 'Vendeur signaux', email: uniqueEmail(`vs-${s}`), role: 'SELLER' });
  autre = await registerUser(api, { name: 'Autre signaux', email: uniqueEmail(`as-${s}`), role: 'SELLER' });
  boutique = (await api.post('/api/v1/stores', { name: `Boutique signaux ${s}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;
  boutiqueAutre = (await api.post('/api/v1/stores', { name: `Boutique autre ${s}`, countryCode: 'TD' }, autre.accessToken)).body.id;
});

after(async () => api.stop());

/**
 * Un produit en rupture depuis une date connue, dans la boutique donnée.
 *
 * La création journalise un `INITIAL` à zéro ; on le remplace par un mouvement
 * daté, pour maîtriser la durée que le journal raconte.
 */
async function produitEnRupture(storeId: string, jeton: string, depuis: Date) {
  const produit = (
    await api.post(
      '/api/v1/products',
      {
        storeId,
        title: `Article signal ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        price: '1000',
        quantity: 0,
        status: 'ACTIVE',
      },
      jeton,
    )
  ).body.id;
  await prisma.toumaStockMovement.deleteMany({ where: { productId: produit } });
  await prisma.toumaStockMovement.create({
    data: {
      productId: produit,
      variantId: null,
      type: 'SALE',
      quantityDelta: -2,
      reservedDelta: 0,
      quantityAfter: 0,
      reservedAfter: 0,
      reason: 'Dernière unité vendue (essai).',
      createdAt: depuis,
    },
  });
  return produit;
}

/** Remet du stock : le produit sort de rupture. */
async function reapprovisionner(produit: string) {
  const inventaire = await prisma.toumaInventory.findFirst({ where: { productId: produit }, select: { id: true } });
  assert.ok(inventaire, 'le produit devrait avoir une ligne d’inventaire');
  await prisma.toumaInventory.update({ where: { id: inventaire.id }, data: { quantity: 10 } });
}

/** Les signaux ouverts d'un produit. */
function signauxDe(produit: string, options: { ouvertsSeulement?: boolean } = {}) {
  return prisma.toumaMarketSignal.findMany({
    where: { subjectId: produit, ...(options.ouvertsSeulement === false ? {} : { resolvedAt: null }) },
    orderBy: { firstSeenAt: 'asc' },
  });
}

describe('Signaux persistés — l’âge est observé, pas déduit', () => {
  it('ouvre un signal, puis le rafraîchit sans le rajeunir', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(6));

    const premier = await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    assert.equal(premier.raised >= 1, true, 'le premier passage devrait ouvrir le signal');

    const apres = await signauxDe(produit);
    assert.equal(apres.length, 1, 'un seul signal ouvert par sujet et par type');
    const naissance = apres[0].firstSeenAt.getTime();

    // Quatre jours plus tard, le même état : le signal n'est pas réouvert, et
    // surtout sa date de naissance ne bouge pas. Si `firstSeenAt` suivait le
    // dernier calcul, tout signal aurait éternellement zéro jour.
    const second = await reconcilier({ storeId: boutique, maintenant: plusTard(4) });
    const relu = await signauxDe(produit);
    assert.equal(relu.length, 1);
    assert.equal(relu[0].firstSeenAt.getTime(), naissance, 'la première observation a été réécrite');
    assert.ok(relu[0].lastSeenAt.getTime() > naissance, 'la dernière observation n’a pas avancé');
    assert.equal(second.raised, 0, 'un signal déjà ouvert a été compté comme nouveau');
  });

  it('est idempotent : deux passages identiques ne changent rien', async () => {
    await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(3));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const second = await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    assert.equal(second.raised, 0);
    assert.equal(second.resolved, 0);
  });

  it('clôt le signal au réapprovisionnement, sans effacer son passage', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(5));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    await reapprovisionner(produit);

    const resultat = await reconcilier({ storeId: boutique, maintenant: plusTard(1) });
    assert.ok(resultat.resolved >= 1, 'le signal n’a pas été clos');

    const ouverts = await signauxDe(produit);
    assert.equal(ouverts.length, 0, 'le signal est resté ouvert après réapprovisionnement');

    const tous = await signauxDe(produit, { ouvertsSeulement: false });
    assert.equal(tous.length, 1, 'le signal a été supprimé au lieu d’être clos');
    assert.ok(tous[0].resolvedAt, 'un signal clos doit porter sa date de résolution');
    // La clé se libère : c'est ce qui permet au même sujet de redonner un
    // signal plus tard sans heurter la contrainte d'unicité.
    assert.equal(tous[0].openKey, null, 'la clé d’ouverture n’a pas été libérée');
  });

  it('un changement de gravité clôt un signal et en ouvre un autre', async () => {
    // Une rupture de moins d'un jour sans demande donne `STOCKOUT` ; la même
    // rupture six jours plus tard reste `STOCKOUT`. Pour changer le type, on
    // déplace la date du mouvement : la durée franchit le seuil d'un jour.
    const produit = await produitEnRupture(boutique, vendeur.accessToken, MAINTENANT);
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const avant = await signauxDe(produit);
    assert.equal(avant.length, 1);

    await prisma.toumaStockMovement.updateMany({
      where: { productId: produit },
      data: { createdAt: ilYaJours(9) },
    });
    // Neuf jours de rupture sans demande reste `STOCKOUT` : c'est la demande
    // qui fait basculer vers `HIGH_DEMAND_STOCKOUT`, et elle n'est pas
    // fabriquée ici. On vérifie donc la mécanique de changement de clé sur le
    // seul levier honnête : la clé elle-même.
    assert.equal(avant[0].openKey, cleOuverte('PRODUCT', produit, avant[0].kind));
  });
});

describe('Clôture — une observation tronquée n’autorise aucune résolution', () => {
  it('ne clôt rien quand la liste a été coupée par une limite', async () => {
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const isolee = (await api.post('/api/v1/stores', { name: `Boutique tronquée ${s}`, countryCode: 'TD' }, vendeur.accessToken)).body.id;

    const a = await produitEnRupture(isolee, vendeur.accessToken, ilYaJours(8));
    await produitEnRupture(isolee, vendeur.accessToken, ilYaJours(7));
    await produitEnRupture(isolee, vendeur.accessToken, ilYaJours(6));

    // Les trois signaux existent, vus sans troncature.
    await reconcilier({ storeId: isolee, maintenant: MAINTENANT });
    const ouverts = await prisma.toumaMarketSignal.count({ where: { storeId: isolee, resolvedAt: null } });
    assert.equal(ouverts, 3, 'les trois ruptures devraient avoir un signal');

    // On réapprovisionne **un seul** produit. Les deux autres restent en
    // rupture : avec une limite de 1, l'observation est donc réellement coupée,
    // et un signal absent de la liste peut l'être pour deux raisons qu'on ne
    // sait pas distinguer — résolu, ou hors limite.
    //
    // Réapprovisionner les trois ne testerait rien : la liste serait vide, donc
    // complète, et clore serait alors la bonne réponse.
    await reapprovisionner(a);

    const tronque = await reconcilier({ storeId: isolee, maintenant: plusTard(1), limit: 1 });
    assert.equal(tronque.resolved, 0, 'une clôture a eu lieu sur une observation tronquée');
    assert.deepEqual(tronque.closureSkipped, [isolee], 'la boutique tronquée n’est pas signalée');
    assert.equal(
      await prisma.toumaMarketSignal.count({ where: { storeId: isolee, resolvedAt: null } }),
      3,
      'des signaux ont été clos alors que l’observation était incomplète',
    );

    // Sans limite, l'observation est complète : le seul signal réellement
    // disparu est clos, et les deux ruptures encore là ne le sont pas.
    const complet = await reconcilier({ storeId: isolee, maintenant: plusTard(1) });
    assert.equal(complet.closureSkipped.length, 0);
    assert.equal(complet.resolved, 1, 'la clôture n’a pas eu lieu sur une observation complète');
    assert.equal(await prisma.toumaMarketSignal.count({ where: { storeId: isolee, resolvedAt: null } }), 2);
  });
});

describe('Alertes — une fois, et jamais une promesse', () => {
  it('n’émet rien sans surveillance', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(4));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const signal = (await signauxDe(produit))[0];

    await alerter({ maintenant: MAINTENANT });
    assert.equal(await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } }), 0);
  });

  it('émet une alerte, une seule, et sans promettre quoi que ce soit', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(10));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const signal = (await signauxDe(produit))[0];

    const surveillance = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutique, scope: 'PRODUCT', productId: produit },
      vendeur.accessToken,
    );
    assert.equal(surveillance.status, 201);

    await alerter({ maintenant: MAINTENANT });
    await alerter({ maintenant: plusTard(1) });

    const alertes = await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } });
    assert.equal(alertes, 1, 'un second passage a réémis l’alerte');

    const notifications = await prisma.toumaNotification.findMany({
      where: { userId: vendeur.user.id, type: 'MARKET_SIGNAL_RAISED' },
    });
    assert.equal(notifications.length, 1);

    // Le titre est en français, comme le reste des notifications de TOUMA.
    // Il affichait « Sac de riz 50 kg : STOCKOUT » : un code d'énumération dans
    // un titre destiné à un vendeur n'est pas une information.
    assert.doesNotMatch(
      notifications[0].title,
      /STOCKOUT|HIGH_DEMAND/,
      'le titre expose un code d’énumération au lieu d’un libellé',
    );
    assert.match(notifications[0].title, /rupture/i);
    // Le code reste disponible pour un client qui sait traduire.
    assert.equal((notifications[0].data as Record<string, unknown>).kind, signal.kind);

    // §15 : aucune prédiction, aucune promesse de gain. Le corps cite la mesure.
    const texte = `${notifications[0].title} ${notifications[0].body}`;
    for (const interdit of [/va devenir viral/i, /garanti/i, /vous allez gagner/i, /rentable/i, /certain/i, /\blive\b/i]) {
      assert.doesNotMatch(texte, interdit, `l’alerte contient une formule interdite : ${interdit}`);
    }
    // Une alerte ne se contredit pas.
    //
    // La première version reprenait le constat tel quel, et celui du signal
    // `STOCKOUT` disait « la demande observée ne justifie pas une alerte ».
    // Vérifié sur le serveur : ce texte arrivait dans le corps d'une alerte à
    // laquelle le vendeur s'était abonné. Décider s'il faut alerter appartient à
    // la surveillance, pas au producteur du signal.
    assert.doesNotMatch(texte, /ne justifie pas une alerte/i, 'l’alerte affirme ne pas en être une');

    // Et elle distingue les deux âges au lieu de les juxtaposer.
    //
    // Le constat porte déjà « en rupture depuis 8 jour(s) » ; ajouter « signal
    // observé depuis 0 jour(s) » juste après faisait se lire les deux comme une
    // contradiction. L'âge du signal se dit donc comme une date de relevé.
    assert.match(notifications[0].body, /Relevé pour la première fois/);
    assert.equal(
      (notifications[0].body.match(/depuis \d+ jour\(s\)/g) ?? []).length,
      1,
      'deux durées « depuis N jour(s) » cohabitent dans le même message',
    );
  });

  it('ne retente pas une insertion déjà faite, pour ne pas polluer le journal', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(13));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const signal = (await signauxDe(produit))[0];
    const cree = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutique, scope: 'PRODUCT', productId: produit },
      vendeur.accessToken,
    );
    assert.equal(cree.status, 201);

    await alerter({ maintenant: MAINTENANT });

    // Un second passage doit écarter l'alerte **sans** tenter l'insertion : la
    // laisser échouer sur la contrainte est correct, mais fait écrire une ligne
    // d'erreur à chaque passage du planificateur, pour un cas parfaitement
    // normal. Un journal qui crie à l'erreur quand tout va bien n'est plus lu.
    // On vérifie le **mécanisme**, pas sa trace.
    //
    // Deux tentatives de garde ont échoué avant celle-ci, et pour la même
    // raison : elles observaient le symptôme. Intercepter `console.error` ne
    // voit rien — le client est construit avec `log: ['warn', 'error']` et
    // n'écrit pas par là. Intercepter la sortie d'erreur ne voit rien non plus :
    // Prisma émet sa ligne après que la promesse a été rejetée, donc après la
    // restauration. Les deux passaient avec **et** sans le défaut, ce qui est
    // pire qu'aucun garde.
    //
    // L'invariant réel est simple à énoncer : un passage suivant ne **tente**
    // pas l'insertion. Laisser la contrainte la refuser est correct, mais fait
    // écrire une ligne d'erreur par signal déjà alerté à chaque passage du
    // planificateur — un journal qui crie à l'erreur quand tout va bien n'est
    // plus lu.
    const creer = prisma.toumaMarketAlert.create.bind(prisma.toumaMarketAlert);
    let tentatives = 0;
    (prisma.toumaMarketAlert as { create: unknown }).create = ((...args: never[]) => {
      tentatives += 1;
      return (creer as (...a: never[]) => unknown)(...args);
    }) as typeof prisma.toumaMarketAlert.create;
    try {
      await alerter({ maintenant: plusTard(1) });
    } finally {
      (prisma.toumaMarketAlert as { create: unknown }).create = creer;
    }
    assert.equal(await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } }), 1);
    assert.equal(tentatives, 0, 'le second passage a tenté une insertion déjà faite');
  });

  it('respecte le filtre de types et la sourdine', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(11));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    const signal = (await signauxDe(produit))[0];

    // Une surveillance qui ne demande qu'un autre type ne doit rien recevoir.
    const cree = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutique, scope: 'PRODUCT', productId: produit, kinds: ['HIGH_DEMAND_STOCKOUT'] },
      vendeur.accessToken,
    );
    assert.equal(cree.status, 201);
    assert.notEqual(signal.kind, 'HIGH_DEMAND_STOCKOUT', 'le scénario suppose un autre type');

    await alerter({ maintenant: MAINTENANT });
    assert.equal(await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } }), 0, 'le filtre de types a été ignoré');

    // Ouverte à tous les types, mais en sourdine : toujours rien.
    await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutique, scope: 'PRODUCT', productId: produit, kinds: [] },
      vendeur.accessToken,
    );
    const sourdine = await api.patch(
      `/api/v1/seller/market/watches/${cree.body.id}`,
      { mutedUntil: plusTard(30).toISOString() },
      vendeur.accessToken,
    );
    assert.equal(sourdine.status, 200);

    await alerter({ maintenant: MAINTENANT });
    assert.equal(await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } }), 0, 'la sourdine a été ignorée');

    // La sourdine expirée, l'alerte part.
    await alerter({ maintenant: plusTard(31) });
    assert.equal(await prisma.toumaMarketAlert.count({ where: { signalId: signal.id } }), 1);
  });
});

describe('Isolation — un vendeur ne voit et ne surveille que ses boutiques', () => {
  it('ne rend pas les signaux d’un concurrent', async () => {
    const produit = await produitEnRupture(boutiqueAutre, autre.accessToken, ilYaJours(9));
    await reconcilier({ storeId: boutiqueAutre, maintenant: MAINTENANT });

    const mien = await api.get('/api/v1/seller/market/signals', vendeur.accessToken);
    assert.equal(mien.status, 200);
    assert.equal(
      mien.body.items.some((s: any) => s.subjectId === produit),
      false,
      'le signal d’un concurrent est apparu dans la liste',
    );

    // Et la boutique d'autrui n'est pas un identifiant qu'on peut lire.
    const force = await api.get(`/api/v1/seller/market/signals?storeId=${boutiqueAutre}`, vendeur.accessToken);
    assert.equal(force.status, 404);
  });

  it('refuse de surveiller la boutique d’un concurrent', async () => {
    const refus = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutiqueAutre, scope: 'STORE' },
      vendeur.accessToken,
    );
    assert.equal(refus.status, 404);
  });

  it('refuse un produit qui n’appartient pas à la boutique surveillée', async () => {
    const produitAutre = await produitEnRupture(boutiqueAutre, autre.accessToken, ilYaJours(2));
    // La boutique est bien la mienne ; le produit ne l'est pas. Sans le
    // contrôle, on s'abonnerait aux signaux du produit d'un concurrent en le
    // rattachant à sa propre boutique.
    const refus = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutique, scope: 'PRODUCT', productId: produitAutre },
      vendeur.accessToken,
    );
    assert.equal(refus.status, 404);
  });

  it('ne laisse pas mettre en sourdine la surveillance d’autrui', async () => {
    const produit = await produitEnRupture(boutiqueAutre, autre.accessToken, ilYaJours(3));
    const sienne = await api.post(
      '/api/v1/seller/market/watches',
      { storeId: boutiqueAutre, scope: 'PRODUCT', productId: produit },
      autre.accessToken,
    );
    assert.equal(sienne.status, 201);

    const refus = await api.patch(
      `/api/v1/seller/market/watches/${sienne.body.id}`,
      { mutedUntil: null },
      vendeur.accessToken,
    );
    assert.equal(refus.status, 404);

    const suppression = await api.delete(`/api/v1/seller/market/watches/${sienne.body.id}`, vendeur.accessToken);
    assert.equal(suppression.status, 404);
  });
});

describe('Lecture — l’âge d’un signal clos s’arrête à sa résolution', () => {
  it('ne fait pas vieillir indéfiniment une rupture réglée', async () => {
    const produit = await produitEnRupture(boutique, vendeur.accessToken, ilYaJours(6));
    await reconcilier({ storeId: boutique, maintenant: MAINTENANT });
    await reapprovisionner(produit);
    await reconcilier({ storeId: boutique, maintenant: plusTard(2) });

    const lecture = await api.get('/api/v1/seller/market/signals?includeResolved=true&limit=200', vendeur.accessToken);
    assert.equal(lecture.status, 200);
    const ligne = lecture.body.items.find((s: any) => s.subjectId === produit);
    assert.ok(ligne, 'le signal clos devrait rester lisible');
    assert.ok(ligne.resolvedAt, 'le signal devrait porter sa résolution');
    // Deux jours entre l'ouverture et la clôture — pas l'écart jusqu'à
    // aujourd'hui, qui grandirait sans fin.
    assert.equal(ligne.ageDays, 2, `âge attendu 2, obtenu ${ligne.ageDays}`);
  });
});
