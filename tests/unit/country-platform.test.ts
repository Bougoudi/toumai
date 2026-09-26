import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYS, valider } from '../../prisma/seeds/countries/index.js';
import type { DescripteurPays } from '../../prisma/seeds/countries/types.js';
import { transitionAutorisee } from '../../src/touma/platform/country.service.js';
import { statutsAtteignables, verdictGlobal, type Controle } from '../../src/touma/platform/country-readiness.js';
import { formaterDate, jourCivil } from '../../src/touma/platform/timezone.service.js';

/** Un contrôle factice, pour éprouver la logique sans base. */
function bloc(bloque: Controle['bloque']): Controle {
  return { domaine: 'shipping', etat: 'BLOCKED', detail: 'essai', bloque };
}

describe('Marchés — cycle de vie', () => {
  it('n’autorise pas de sauter une étape vers l’ouverture', () => {
    // Le cœur de §3. Sans cette règle, ouvrir un marché reste un UPDATE.
    assert.equal(transitionAutorisee('PLANNED', 'ACTIVE'), false);
    assert.equal(transitionAutorisee('PLANNED', 'PILOT'), false);
    assert.equal(transitionAutorisee('CONFIGURING', 'ACTIVE'), false);
    assert.equal(transitionAutorisee('TESTING', 'ACTIVE'), false);

    assert.equal(transitionAutorisee('PLANNED', 'CONFIGURING'), true);
    assert.equal(transitionAutorisee('CONFIGURING', 'TESTING'), true);
    assert.equal(transitionAutorisee('TESTING', 'PILOT'), true);
    assert.equal(transitionAutorisee('PILOT', 'ACTIVE'), true);
  });

  it('laisse toujours refermer un marché, depuis n’importe où', () => {
    // Suspendre un marché qui va mal ne doit jamais demander de passer par un
    // état intermédiaire : c'est en général au pire moment qu'on le fait.
    for (const depuis of ['CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'LIMITED'] as const) {
      assert.equal(transitionAutorisee(depuis, 'SUSPENDED'), true, `${depuis} → SUSPENDED`);
    }
  });

  it('ne rouvre pas un marché suspendu directement en ACTIVE', () => {
    // Ce qui l'a fait suspendre doit être revérifié.
    assert.equal(transitionAutorisee('SUSPENDED', 'ACTIVE'), false);
    assert.equal(transitionAutorisee('SUSPENDED', 'TESTING'), true);
  });
});

describe('Marchés — préparation', () => {
  it('un blocage retire exactement les statuts qu’il vise', () => {
    const atteignables = statutsAtteignables([bloc(['PILOT', 'ACTIVE', 'LIMITED'])]);
    assert.deepEqual(atteignables, ['PLANNED', 'CONFIGURING', 'TESTING', 'SUSPENDED', 'DEPRECATED']);
  });

  /**
   * §4 ne prévoit que READY/WARNING/BLOCKED. Un domaine que rien ne mesure ne
   * rentre dans aucun des trois : le dire vert serait le faux statut que V25
   * §89 interdit, le dire rouge laisserait croire qu'on a regardé.
   */
  it('un domaine non mesuré ne dégrade pas le verdict et ne se confond pas avec un feu vert', () => {
    const controles: Controle[] = [
      { domaine: 'database', etat: 'READY', detail: 'x', bloque: [] },
      { domaine: 'analytics', etat: 'NOT_MEASURED', detail: 'x', bloque: [] },
    ];
    assert.equal(verdictGlobal(controles), 'READY');
    // …mais il n'empêche aucun statut non plus : il n'est pas un blocage.
    assert.equal(statutsAtteignables(controles).includes('ACTIVE'), true);
    // Et il reste identifiable : c'est tout l'intérêt du quatrième état.
    assert.equal(controles.filter((c) => c.etat === 'NOT_MEASURED').length, 1);
  });

  it('un blocage prime sur un avertissement', () => {
    assert.equal(
      verdictGlobal([
        { domaine: 'ai', etat: 'WARNING', detail: 'x', bloque: [] },
        { domaine: 'shipping', etat: 'BLOCKED', detail: 'x', bloque: [] },
      ]),
      'BLOCKED',
    );
  });
});

describe('Marchés — descripteurs de seed (§55)', () => {
  it('tous les descripteurs livrés sont valides', () => {
    for (const p of PAYS) assert.deepEqual(valider(p), [], `${p.code} : ${valider(p).join(' ; ')}`);
  });

  it('aucun marché n’est déclaré ouvert sans configuration commerciale', () => {
    // §79 pris au mot, appliqué à la source : un descripteur ne doit pas
    // pouvoir déclarer un pays ACTIVE en passant à côté du commerce.
    for (const p of PAYS) {
      if (p.status === 'ACTIVE' || p.status === 'PILOT') {
        assert.ok(p.trade?.enabled, `${p.code} est ${p.status} sans configuration commerciale`);
      }
    }
  });

  it('le Cameroun n’est pas déclaré ouvert à l’achat', () => {
    // Il l'était : actif, achat et vente ouverts, sans une seule division
    // administrative ni un transporteur réel.
    const cm = PAYS.find((p) => p.code === 'CM');
    assert.ok(cm);
    assert.equal(cm.status, 'CONFIGURING');
    assert.equal(cm.buyingEnabled, false);
  });

  it('refuse un fuseau laissé à UTC', () => {
    const faux: DescripteurPays = { ...PAYS[0], timezone: 'UTC' };
    assert.match(valider(faux).join(' '), /fuseau/);
  });

  it('refuse deux niveaux administratifs au même rang', () => {
    const faux: DescripteurPays = {
      ...PAYS[0],
      divisionLevels: [
        { level: 1, name: 'A', namePlural: 'As', used: true },
        { level: 1, name: 'B', namePlural: 'Bs', used: true },
      ],
    };
    assert.match(valider(faux).join(' '), /même rang/);
  });

  it('chaque pays nomme ses niveaux comme son administration les nomme (§7)', () => {
    // Le Cameroun a des régions et des arrondissements, pas des provinces et
    // des sous-préfectures. Afficher le vocabulaire tchadien à un Camerounais
    // lui dit que ce marché n'est pas le sien.
    const td = PAYS.find((p) => p.code === 'TD')!;
    const cm = PAYS.find((p) => p.code === 'CM')!;
    assert.equal(td.divisionLevels.find((n) => n.level === 1)?.name, 'Province');
    assert.equal(cm.divisionLevels.find((n) => n.level === 1)?.name, 'Région');
    assert.equal(cm.divisionLevels.find((n) => n.level === 3)?.name, 'Arrondissement');
  });
});

describe('Fuseaux horaires (§18)', () => {
  /**
   * Le défaut, reproduit. Une commande passée à 00h30 à N'Djamena est stockée
   * à 23h30 UTC la veille ; rendue sans fuseau, elle change de jour.
   */
  it('une commande de minuit trente à N’Djamena ne change pas de jour', () => {
    const instant = new Date('2026-09-22T23:30:00Z');
    assert.equal(jourCivil(instant, 'Africa/Ndjamena'), '2026-09-23');
    // Ce que l'ancien code rendait, faute de fuseau : la veille.
    assert.equal(jourCivil(instant, 'UTC'), '2026-09-22');
    assert.notEqual(jourCivil(instant, 'Africa/Ndjamena'), jourCivil(instant, 'UTC'));
  });

  it('rend la même heure différemment selon le marché', () => {
    const instant = new Date('2026-09-22T23:30:00Z');
    const ndjamena = formaterDate(instant, { timezone: 'Africa/Ndjamena', avecHeure: true });
    const nairobi = formaterDate(instant, { timezone: 'Africa/Nairobi', avecHeure: true });
    assert.notEqual(ndjamena, nairobi);
    assert.match(ndjamena, /23\/09\/2026/);
    assert.match(nairobi, /23\/09\/2026/);
  });

  it('ne produit rien pour une date invalide plutôt qu’« Invalid Date »', () => {
    assert.equal(formaterDate('pas une date', { timezone: 'UTC' }), '');
    assert.equal(jourCivil('pas une date', 'UTC'), '');
  });
});
