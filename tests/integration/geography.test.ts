import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { loadGeography } from '../../src/touma/geo/geography.loader.js';
import { registerUser, TestApi, uniqueEmail } from '../helpers/api.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';

/**
 * Géographie nationale du Tchad (V17).
 *
 * Ce qui est vérifié ici tient en une idée : **la plateforme sait où se trouvent
 * les gens**, et ce qu'elle en dit vient d'une source, jamais d'une invention.
 */
const api = new TestApi();

let seller: any;

before(async () => {
  ensureSchema();
  await ensureReferenceData();
  await api.start();
  // Le chargeur est idempotent : l'appeler ici ne dérange pas un seed déjà fait.
  await loadGeography('TD');
  seller = await registerUser(api, { name: 'Vendeur géo', email: uniqueEmail('geo-seller'), role: 'SELLER', countryCode: 'TD' });
});

after(async () => {
  await api.stop();
});

describe('Les 23 provinces du Tchad', () => {
  it('sont toutes chargées, et rattachées au pays', async () => {
    const res = await api.get('/api/v1/geo/provinces?country=TD');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 23, 'le Tchad compte 23 provinces');
    assert.ok(
      res.body.items.every((p: any) => p.countryCode === 'TD'),
      'aucune province orpheline',
    );
  });

  it('portent toutes leur nom arabe, seconde langue officielle', async () => {
    const res = await api.get('/api/v1/geo/provinces?country=TD');
    const sansArabe = res.body.items.filter((p: any) => !p.nameAr);
    assert.deepEqual(sansArabe.map((p: any) => p.name), [], 'toutes les provinces ont un nom arabe');
  });

  it('portent un code officiel stable, sur lequel on peut faire une jointure', async () => {
    // Les graphies varient d'une source à l'autre (« Ouadaï », « Ouaddaï ») ;
    // le code, lui, ne bouge pas. C'est lui qui fait la jointure.
    const res = await api.get('/api/v1/geo/provinces?country=TD');
    const codes = res.body.items.map((p: any) => p.code).sort();
    assert.equal(new Set(codes).size, 23, 'aucun code en double');
    assert.ok(codes.every((c: string) => /^[0-9]{2}$/.test(c)), 'les codes sont ceux de la source');
  });

  it('donnent accès à leurs départements', async () => {
    const provinces = (await api.get('/api/v1/geo/provinces?country=TD')).body.items;
    const total = provinces.reduce((n: number, p: any) => n + p.departmentCount, 0);
    assert.equal(total, 133, 'le Tchad compte 133 départements dans la source');

    const avecDepartements = provinces.find((p: any) => p.departmentCount > 0);
    const res = await api.get(`/api/v1/geo/provinces/${avecDepartements.id}/departments`);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, avecDepartements.departmentCount);
  });

  it('répondent « introuvable » pour une province qui n’existe pas', async () => {
    const res = await api.get('/api/v1/geo/provinces/pas-une-province/departments');
    assert.equal(res.status, 404);
  });
});

describe('Localités', () => {
  it('sont rattachées à leur province, et rendues par page', async () => {
    const provinces = (await api.get('/api/v1/geo/provinces?country=TD')).body.items;
    const ndjamena = provinces.find((p: any) => /Djam/i.test(p.name));
    assert.ok(ndjamena, 'N’Djamena figure parmi les provinces');

    const res = await api.get(`/api/v1/geo/provinces/${ndjamena.id}/localities?limit=10`);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length <= 10, 'la liste est bornée');
    // `hasMore` doit dire la vérité : une liste tronquée ne se présente pas
    // comme complète.
    assert.equal(typeof res.body.hasMore, 'boolean');
  });

  it('se cherchent par nom dans tout le pays, sans connaître la province', async () => {
    // Le cas courant : on sait le nom de sa ville, pas son découpage
    // administratif.
    const res = await api.get('/api/v1/geo/localities?country=TD&q=Moundou');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0, 'Moundou est trouvée');
    assert.ok(res.body.items[0].province?.name, 'la province est rendue avec la localité');
  });

  it('ne répondent rien à une recherche trop courte', async () => {
    // Deux lettres sur douze mille lignes, c'est une réponse inutile envoyée sur
    // un réseau lent.
    const res = await api.get('/api/v1/geo/localities?country=TD&q=M');
    assert.deepEqual(res.body.items, []);
  });
});

describe('Ce que la source ne dit pas n’est pas inventé', () => {
  it('ne fabrique aucune sous-préfecture', async () => {
    // Aucune source exploitable ne descend à ce niveau pour le Tchad. La table
    // existe pour le jour où l'une paraîtra ; la remplir de mémoire reviendrait
    // à inscrire en base une organisation administrative imaginaire.
    const total = await prisma.toumaSubPrefecture.count();
    assert.equal(total, 0, 'aucune sous-préfecture inventée');
  });

  it('laisse sans département les localités que la source ne rattache pas', async () => {
    const sansDepartement = await prisma.toumaLocality.count({
      where: { province: { countryCode: 'TD' }, departmentId: null },
    });
    const total = await prisma.toumaLocality.count({ where: { province: { countryCode: 'TD' } } });
    // C'est la réalité de la source : le rattachement au département y est
    // quasi absent. Le combler « au plus proche » serait une invention de masse.
    assert.ok(sansDepartement > total * 0.9, 'le trou de la source est visible, pas comblé');
  });

  it('distingue population inconnue et population nulle', async () => {
    const chiffrees = await prisma.toumaLocality.count({
      where: { province: { countryCode: 'TD' }, population: { not: null } },
    });
    const zero = await prisma.toumaLocality.count({ where: { province: { countryCode: 'TD' }, population: 0 } });
    assert.ok(chiffrees > 0 && chiffrees < 200, 'seule une poignée de localités est chiffrée');
    assert.equal(zero, 0, 'un 0 de la source veut dire « inconnu » : il n’est jamais stocké comme une population nulle');
  });
});

describe('Rejouer le chargement', () => {
  it('ne duplique rien', async () => {
    const avant = await prisma.toumaLocality.count({ where: { province: { countryCode: 'TD' } } });
    const provincesAvant = await prisma.toumaProvince.count({ where: { countryCode: 'TD' } });

    await loadGeography('TD');

    assert.equal(await prisma.toumaLocality.count({ where: { province: { countryCode: 'TD' } } }), avant);
    assert.equal(await prisma.toumaProvince.count({ where: { countryCode: 'TD' } }), provincesAvant);
  });
});

describe('Découverte des vendeurs par province', () => {
  it('trouve les vendeurs d’une province, sans exclure les autres', async () => {
    const provinces = (await api.get('/api/v1/geo/provinces?country=TD')).body.items;
    const ndjamena = provinces.find((p: any) => /Djam/i.test(p.name));
    const ouaddai = provinces.find((p: any) => /Ouada/i.test(p.name));

    const boutique = await api.post(
      '/api/v1/stores',
      { name: `Boutique Ouaddaï ${Date.now()}`, countryCode: 'TD', description: 'Test géographique' },
      seller.accessToken,
    );
    assert.equal(boutique.status, 201);
    await prisma.toumaStore.update({
      where: { id: boutique.body.id },
      data: { provinceId: ouaddai.id, status: 'ACTIVE' },
    });

    const auOuaddai = await api.get(`/api/v1/stores?country=TD&province=${ouaddai.id}`);
    assert.ok(
      auOuaddai.body.items.some((s: any) => s.id === boutique.body.id),
      'la boutique apparaît dans sa province',
    );

    // Le code officiel marche aussi : une page publique connaît le code, pas
    // l'identifiant interne.
    const parCode = await api.get(`/api/v1/stores?country=TD&province=${ouaddai.code}`);
    assert.ok(parCode.body.items.some((s: any) => s.id === boutique.body.id), 'le code officiel est accepté');

    // Et elle n'apparaît pas dans une autre province.
    const aNdjamena = await api.get(`/api/v1/stores?country=TD&province=${ndjamena.id}`);
    assert.equal(
      aNdjamena.body.items.some((s: any) => s.id === boutique.body.id),
      false,
      'une boutique n’apparaît pas dans une province où elle n’est pas',
    );

    // Sans filtre, elle reste visible de tout le pays : la proximité est un
    // ordre de passage, jamais un mur (§14).
    const partout = await api.get('/api/v1/stores?country=TD&limit=100');
    assert.ok(
      partout.body.items.some((s: any) => s.id === boutique.body.id),
      'aucun vendeur n’est exclu faute d’être au bon endroit',
    );
  });

  it('rend la province dans la fiche publique de la boutique', async () => {
    const res = await api.get('/api/v1/stores?country=TD&limit=5');
    assert.equal(res.status, 200);
    // Le champ existe, même quand il est nul : c'est ce qui permet à l'interface
    // de dire « province non renseignée » plutôt que de l'ignorer.
    assert.ok('province' in res.body.items[0], 'la province fait partie de la fiche');
  });
});

describe('Ce qui est écrit dans une adresse', () => {
  it('range le téléphone en E.164, quelle que soit la façon de l’écrire', async () => {
    // Le branchement compte autant que la fonction : une normalisation qui
    // existe mais n'est appelée nulle part ne range rien.
    const res = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Test téléphone', phone: '66 12 34 56', line1: 'Rue 1', city: "N'Djamena", countryCode: 'TD' },
      seller.accessToken,
    );
    assert.equal(res.status, 201);

    const adresse = await prisma.toumaAddress.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(adresse.phone, '+23566123456', 'le numéro est rangé sous une seule forme');
  });

  it('refuse un numéro qui n’en est pas un', async () => {
    const res = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Test', phone: '6612345', line1: 'Rue 1', city: "N'Djamena", countryCode: 'TD' },
      seller.accessToken,
    );
    assert.equal(res.status, 400, 'sept chiffres au Tchad, c’est une faute de frappe');
  });

  it('vérifie la géographie au lieu de la recopier', async () => {
    const provinces = (await api.get('/api/v1/geo/provinces?country=TD')).body.items;
    const province = provinces[0];

    // Un identifiant qui n'existe pas est refusé : sinon on n'aurait fait que
    // déguiser du texte libre en clé étrangère.
    const inconnu = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Test', phone: '66123456', line1: 'Rue 1', city: 'Ville', countryCode: 'TD', provinceId: 'cla00000000000000000000000' },
      seller.accessToken,
    );
    assert.equal(inconnu.status, 400);

    // Une localité qui n'est pas dans la province indiquée est une erreur, pas
    // une préférence.
    const autreProvince = provinces[1];
    const localite = (await api.get(`/api/v1/geo/provinces/${autreProvince.id}/localities?limit=1`)).body.items[0];
    const incoherent = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Test', phone: '66123456', line1: 'Rue 1', city: 'Ville', countryCode: 'TD', provinceId: province.id, localityId: localite.id },
      seller.accessToken,
    );
    assert.equal(incoherent.status, 400);
    assert.match(incoherent.body.error, /n’appartient pas à la province/i);

    // Cohérent : accepté, et la province est déduite de la localité quand elle
    // n'est pas donnée — beaucoup de gens connaissent leur ville, pas leur
    // découpage administratif.
    const parLocalite = await api.post(
      '/api/v1/auth/me/addresses',
      { fullName: 'Test', phone: '66123456', line1: 'Rue 1', city: localite.name, countryCode: 'TD', localityId: localite.id },
      seller.accessToken,
    );
    assert.equal(parLocalite.status, 201);
    const enregistree = await prisma.toumaAddress.findUniqueOrThrow({ where: { id: parLocalite.body.id } });
    assert.equal(enregistree.localityId, localite.id);
    assert.equal(enregistree.provinceId, autreProvince.id, 'la province est déduite de la localité');
  });
});
