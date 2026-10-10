import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../../src/db/prisma.js';
import { ensureReferenceData, ensureSchema } from '../helpers/db.js';
import { changerStatut, marcheOuvert, preparation } from '../../src/touma/platform/country.service.js';

/**
 * Activation d'un marché (V26 §3, §4, §44, §45, §79).
 *
 * Le point que ces tests fixent : **on n'ouvre pas un marché en écrivant dans
 * une colonne**. Le Cameroun était déclaré actif sans géographie ni
 * transporteur — un marché annoncé ouvert par lequel rien ne pouvait passer.
 */

before(async () => {
  ensureSchema();
  await ensureReferenceData();
});
after(async () => prisma.$disconnect());

let compteur = 0;
const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Un marché neuf, à nous seuls. Les codes ISO font deux lettres. */
async function marcheNeuf(options: { status?: 'PLANNED' | 'CONFIGURING' | 'TESTING' | 'PILOT' | 'ACTIVE'; geographie?: boolean } = {}) {
  const n = compteur++;
  const code = `Q${LETTRES[n % 26]}`;
  await prisma.toumaCountryStatusChange.deleteMany({ where: { countryCode: code } });
  await prisma.toumaProvince.deleteMany({ where: { countryCode: code } });
  const donnees = {
    name: `Marché d’essai ${code}`,
    currency: 'XAF',
    dialCode: '+000',
    timezone: 'Africa/Ndjamena',
    status: options.status ?? 'PLANNED',
    active: false,
    buyingEnabled: false,
    sellingEnabled: false,
  };
  await prisma.country.upsert({ where: { code }, update: donnees, create: { code, ...donnees } });
  if (options.geographie) {
    await prisma.toumaProvince.create({ data: { countryCode: code, code: '01', name: 'Division d’essai' } });
  }
  return code;
}

describe('Marchés — ouverture', () => {
  it('refuse de sauter une étape, même sans blocage technique', async () => {
    const code = await marcheNeuf();
    await assert.rejects(
      () => changerStatut({ countryCode: code, vers: 'ACTIVE', reason: 'Ouverture demandée par la direction.' }),
      /non autorisée/,
    );
    // Le marché n'a pas bougé : un refus ne laisse pas d'état intermédiaire.
    const apres = await prisma.country.findUnique({ where: { code } });
    assert.equal(apres?.status, 'PLANNED');
  });

  it('refuse une ouverture dont une dépendance manque, en la nommant', async () => {
    const code = await marcheNeuf({ status: 'TESTING' });
    // TESTING → PILOT est une transition légale ; la géographie, elle, manque.
    await assert.rejects(
      () => changerStatut({ countryCode: code, vers: 'PILOT', reason: 'Passage en pilote pour la campagne.' }),
      (err: Error) => {
        assert.match(err.message, /geography|shipping/);
        // Le message doit dire quoi faire, pas seulement que c'est refusé.
        assert.ok(err.message.length > 60, err.message);
        return true;
      },
    );
  });

  it('exige un motif écrit', async () => {
    const code = await marcheNeuf();
    await assert.rejects(() => changerStatut({ countryCode: code, vers: 'CONFIGURING', reason: 'ok' }), /motivé/);
  });

  it('laisse avancer quand la transition et les dépendances le permettent, et le trace', async () => {
    const code = await marcheNeuf({ geographie: true });
    const { country } = await changerStatut({
      countryCode: code,
      vers: 'CONFIGURING',
      reason: 'Début de configuration du marché d’essai.',
    });
    assert.equal(country.status, 'CONFIGURING');

    // La trace, et l'instantané du contrôle tel qu'il était à la décision.
    const trace = await prisma.toumaCountryStatusChange.findFirst({ where: { countryCode: code }, orderBy: { createdAt: 'desc' } });
    assert.equal(trace?.fromStatus, 'PLANNED');
    assert.equal(trace?.toStatus, 'CONFIGURING');
    assert.match(trace?.reason ?? '', /configuration/);
    assert.ok(trace?.readiness, 'le contrôle doit être figé avec la décision');
  });

  it('suspendre ferme les transactions sans rien supprimer (§45)', async () => {
    const code = await marcheNeuf({ status: 'ACTIVE', geographie: true });
    await prisma.country.update({ where: { code }, data: { buyingEnabled: true, sellingEnabled: true, active: true } });

    const { country } = await changerStatut({
      countryCode: code,
      vers: 'SUSPENDED',
      reason: 'Prestataire de paiement indisponible sur ce marché.',
    });
    assert.equal(country.status, 'SUSPENDED');
    assert.equal(country.buyingEnabled, false);
    assert.equal(country.sellingEnabled, false);

    // Rien n'est supprimé : la géographie et l'historique restent lisibles.
    assert.equal(await prisma.toumaProvince.count({ where: { countryCode: code } }), 1);
    assert.ok((await prisma.toumaCountryStatusChange.count({ where: { countryCode: code } })) > 0);
  });

  it('un marché non ouvert n’accepte aucune transaction, quels que soient les interrupteurs', () => {
    // Le piège que `marcheOuvert` ferme : des interrupteurs à vrai sur un
    // marché en configuration laissaient passer achats et ventes.
    const enConfiguration = { status: 'CONFIGURING' as const, buyingEnabled: true, sellingEnabled: true };
    assert.equal(marcheOuvert(enConfiguration, 'BUY'), false);
    assert.equal(marcheOuvert(enConfiguration, 'SELL'), false);

    const ouvert = { status: 'ACTIVE' as const, buyingEnabled: true, sellingEnabled: false };
    assert.equal(marcheOuvert(ouvert, 'BUY'), true);
    assert.equal(marcheOuvert(ouvert, 'SELL'), false);
  });
});

describe('Marchés — contrôle de préparation sur données réelles', () => {
  it('signale un marché dont le statut n’est plus justifié par les contrôles', async () => {
    const code = await marcheNeuf({ status: 'ACTIVE' });
    const p = await preparation(code);
    // Aucune géographie, aucun transporteur : ACTIVE n'est pas soutenable.
    assert.equal(p.statutActuel, 'ACTIVE');
    assert.equal(p.statutJustifie, false);
    assert.equal(p.verdict, 'BLOCKED');
    // Le système ne rétrograde pas tout seul : fermer un marché est une
    // décision. Il le signale, c'est tout — mais il le signale.
    assert.equal((await prisma.country.findUnique({ where: { code } }))?.status, 'ACTIVE');
  });

  it('n’annonce jamais vert un domaine qu’aucune instrumentation ne mesure', async () => {
    const code = await marcheNeuf({ geographie: true });
    const p = await preparation(code);
    for (const domaine of ['support', 'legal', 'analytics'] as const) {
      const controle = p.controles.find((c) => c.domaine === domaine);
      assert.equal(controle?.etat, 'NOT_MEASURED', `${domaine} ne doit pas être déclaré vert`);
      assert.ok(p.nonMesures.includes(domaine));
    }
  });

  it('chaque contrôle dit ce qui a été constaté, jamais « OK »', async () => {
    const code = await marcheNeuf({ geographie: true });
    const p = await preparation(code);
    for (const c of p.controles) {
      assert.ok(c.detail.length > 15, `${c.domaine} : détail trop court — « ${c.detail} »`);
      assert.doesNotMatch(c.detail, /^OK\b|^Bon\b/i, `${c.domaine} : détail vide de sens`);
    }
  });
});

describe('Régression Tchad (§8, §78)', () => {
  /**
   * Les 23 provinces, pincées **telles que la source les écrit**.
   *
   * Deux noms diffèrent de la liste de référence interne : « Ouadaï » y est
   * écrit « Ouaddaï », et « Barh el Gazel » « Barh El Gazal ». Ces noms ne
   * sont pas corrigés ici. La source est GeoNames, elle est citée, et
   * réécrire une donnée administrative officielle pour la faire coïncider
   * avec une liste tapée de mémoire produirait exactement l'inverse de ce
   * qu'on cherche : une donnée qui a l'air juste et qui ne l'est plus.
   * L'écart est signalé, pas résorbé en douce.
   */
  const PROVINCES_TCHAD = [
    'Barh el Gazel',
    'Batha',
    'Borkou',
    'Chari-Baguirmi',
    'Ennedi-Est',
    'Ennedi-Ouest',
    'Gu\u00e9ra',
    'Hadjer-Lamis',
    'Kanem',
    'Lac',
    'Logone Occidental',
    'Logone Oriental',
    'Mandoul',
    'Mayo-Kebbi Est',
    'Mayo-Kebbi Ouest',
    'Moyen-Chari',
    'N\u2019Djam\u00e9na',
    'Ouada\u00ef',
    'Salamat',
    'Sila',
    'Tandjil\u00e9',
    'Tibesti',
    'Wadi Fira',
  ].map((n) => n.normalize('NFC'));

  it('les 23 provinces du Tchad restent charg\u00e9es, \u00e0 l\u2019identique', async () => {
    const provinces = await prisma.toumaProvince.findMany({ where: { countryCode: 'TD' }, select: { name: true } });
    // La base de test peut ne pas porter le jeu g\u00e9ographique complet ; quand
    // elle le porte, le compte doit \u00eatre exact \u2014 jamais \u00ab \u00e0 peu pr\u00e8s 23 \u00bb.
    if (provinces.length === 0) return;
    assert.equal(provinces.length, 23, 'le Tchad compte 23 provinces');
    assert.deepEqual(
      provinces.map((p) => p.name.normalize('NFC')).sort(),
      [...PROVINCES_TCHAD].sort(),
      'la g\u00e9ographie du Tchad a chang\u00e9 : \u00e0 v\u00e9rifier contre la source avant de modifier ce test',
    );
  });

  it('le Tchad reste un marché ouvert à l’achat et à la vente', async () => {
    const td = await prisma.country.findUnique({ where: { code: 'TD' } });
    assert.ok(td);
    assert.equal(marcheOuvert(td, 'BUY'), true);
    assert.equal(marcheOuvert(td, 'SELL'), true);
  });
});

