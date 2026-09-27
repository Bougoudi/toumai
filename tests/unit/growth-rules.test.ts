import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { evaluate, type Rule, type RuleContext } from '../../src/touma/growth/rules.js';
import { cap, select, type Candidate } from '../../src/touma/growth/stacking.js';

const D = (n: number | string) => new Prisma.Decimal(n);

const contexte = (over: Partial<RuleContext> = {}): RuleContext => ({
  subtotal: D(30_000),
  quantity: 3,
  currency: 'XAF',
  productIds: ['p1', 'p2'],
  categoryIds: ['c1'],
  storeIds: ['s1'],
  countryCode: 'TD',
  provinceId: 'ndjamena',
  previousOrders: 2,
  segments: ['ACTIVE'],
  stock: 120,
  ...over,
});

const regle = (over: Partial<Rule> & Pick<Rule, 'kind'>): Rule => ({
  threshold: null,
  values: [],
  negated: false,
  ...over,
});

/**
 * Le moteur de règles décide de ce qu'un acheteur paie. Les contrôles portent
 * donc sur les propriétés qui coûtent de l'argent quand elles dérivent : une
 * règle qui n'est pas appliquée, une inconnue qui passe, un seuil mal comparé.
 */
describe('Règles de promotion — seuils', () => {
  it('applique un seuil de montant au centime près', () => {
    const r = [regle({ kind: 'MIN_ORDER_AMOUNT', threshold: D(25_000) })];
    assert.equal(evaluate(r, contexte({ subtotal: D(25_000) })).applicable, true, 'le seuil exact passe');
    assert.equal(evaluate(r, contexte({ subtotal: D('24999.99') })).applicable, false);
  });

  it('dit pourquoi elle ne passe pas, avec les deux montants', () => {
    // Une promotion refusée sans explication est une promotion que l'acheteur
    // croit avoir perdue par hasard.
    const r = [regle({ kind: 'MIN_ORDER_AMOUNT', threshold: D(50_000) })];
    const { failures } = evaluate(r, contexte());
    assert.equal(failures.length, 1);
    assert.equal(failures[0].reason, 'promo.fail.minOrderAmount');
    assert.equal(failures[0].detail.required, '50000');
    assert.equal(failures[0].detail.current, '30000');
  });

  it('compare les quantités, pas les montants', () => {
    const r = [regle({ kind: 'MIN_QUANTITY', threshold: D(5) })];
    assert.equal(evaluate(r, contexte({ quantity: 5 })).applicable, true);
    assert.equal(evaluate(r, contexte({ quantity: 4 })).applicable, false);
  });
});

describe('Règles de promotion — appartenance', () => {
  it('accepte une liste vide comme « aucune restriction »', () => {
    assert.equal(evaluate([regle({ kind: 'CATEGORY' })], contexte()).applicable, true);
  });

  it('exige au moins un produit visé dans le panier', () => {
    assert.equal(evaluate([regle({ kind: 'PRODUCT', values: ['p2'] })], contexte()).applicable, true);
    assert.equal(evaluate([regle({ kind: 'PRODUCT', values: ['p9'] })], contexte()).applicable, false);
  });

  it('inverse la règle quand elle est niée', () => {
    // « sauf cette catégorie » : la même mesure, lue à l'envers.
    const exclusion = [regle({ kind: 'CATEGORY', values: ['c1'], negated: true })];
    assert.equal(evaluate(exclusion, contexte()).applicable, false, 'c1 est présent, donc exclu');
    assert.equal(evaluate(exclusion, contexte({ categoryIds: ['c9'] })).applicable, true);
  });
});

describe('Règles de promotion — géographie', () => {
  it('limite une promotion à des provinces nommées', () => {
    const r = [regle({ kind: 'PROVINCE', values: ['ndjamena', 'mayo-kebbi-est'] })];
    assert.equal(evaluate(r, contexte()).applicable, true);
    assert.equal(evaluate(r, contexte({ provinceId: 'tibesti' })).applicable, false);
  });

  it('refuse une promotion provinciale quand la destination est inconnue', () => {
    // Deviner la province reviendrait à accorder une promotion locale à une
    // livraison dont on ignore où elle va.
    const r = [regle({ kind: 'PROVINCE', values: ['ndjamena'] })];
    assert.equal(evaluate(r, contexte({ provinceId: null })).applicable, false);
  });
});

describe('Règles de promotion — stock', () => {
  it('refuse quand le stock est inconnu', () => {
    // Supposer le stock suffisant ferait tourner une promotion sur un article
    // épuisé, et l'acheteur découvrirait la rupture après avoir cliqué.
    const r = [regle({ kind: 'MIN_STOCK', threshold: D(10) })];
    assert.equal(evaluate(r, contexte({ stock: null })).applicable, false);
    assert.equal(evaluate(r, contexte({ stock: 10 })).applicable, true);
  });

  it('suspend une promotion sous le seuil de stock', () => {
    const r = [regle({ kind: 'MIN_STOCK', threshold: D(100) })];
    assert.equal(evaluate(r, contexte({ stock: 9 })).applicable, false);
  });
});

describe('Règles de promotion — composition', () => {
  it('exige que toutes les règles soient remplies', () => {
    // Un ET, jamais un OU implicite : un OU se modélise par deux promotions.
    const r = [
      regle({ kind: 'MIN_ORDER_AMOUNT', threshold: D(25_000) }),
      regle({ kind: 'CATEGORY', values: ['c1'] }),
      regle({ kind: 'COUNTRY', values: ['TD'] }),
    ];
    assert.equal(evaluate(r, contexte()).applicable, true);
    assert.equal(evaluate(r, contexte({ countryCode: 'CM' })).applicable, false);
  });

  it('rend toutes les raisons, pas seulement la première', () => {
    const r = [
      regle({ kind: 'MIN_ORDER_AMOUNT', threshold: D(100_000) }),
      regle({ kind: 'FIRST_ORDER' }),
    ];
    const { failures } = evaluate(r, contexte());
    assert.equal(failures.length, 2);
  });

  it('n’applique rien sur une règle d’un genre inconnu', () => {
    // Ignorer une règle inconnue reviendrait à appliquer la promotion en
    // sautant la condition qui la limitait.
    const inconnue = { kind: 'RULE_DU_FUTUR', threshold: null, values: [], negated: false } as unknown as Rule;
    const { applicable, failures } = evaluate([inconnue], contexte());
    assert.equal(applicable, false);
    assert.equal(failures[0].reason, 'promo.fail.unknownRule');
  });
});

describe('Cumul et priorité', () => {
  const c = (id: string, stacking: Candidate<string>['stacking'], priority: number, amount: number): Candidate<string> => ({
    promotion: id,
    stacking,
    priority,
    amount: D(amount),
  });

  it('n’applique qu’une seule promotion non cumulable', () => {
    const r = select([c('a', 'NON_STACKABLE', 0, 1000), c('b', 'NON_STACKABLE', 0, 3000)]);
    assert.deepEqual(r.applied.map((x) => x.promotion), ['b'], 'à priorité égale, la plus avantageuse');
    assert.equal(r.excluded.length, 1);
    assert.equal(r.excluded[0].reason, 'promo.excluded.betterNonStackable');
  });

  it('fait primer la priorité sur le montant', () => {
    const r = select([c('a', 'NON_STACKABLE', 10, 1000), c('b', 'NON_STACKABLE', 0, 9000)]);
    assert.deepEqual(r.applied.map((x) => x.promotion), ['a']);
  });

  it('ajoute les cumulables par-dessus la non cumulable retenue', () => {
    const r = select([
      c('base', 'NON_STACKABLE', 0, 2000),
      c('plus', 'STACKABLE', 0, 500),
      c('encore', 'STACKABLE', 0, 300),
    ]);
    assert.deepEqual(r.applied.map((x) => x.promotion).sort(), ['base', 'encore', 'plus']);
  });

  it('écarte tout le reste devant une exclusive, et bloque le code', () => {
    const r = select([
      c('exclu', 'EXCLUSIVE', 0, 5000),
      c('autre', 'NON_STACKABLE', 99, 9000),
      c('petit', 'STACKABLE', 0, 100),
    ]);
    assert.deepEqual(r.applied.map((x) => x.promotion), ['exclu']);
    assert.equal(r.blocksCoupon, true, 'une exclusive interdit aussi un code saisi');
    assert.equal(r.excluded.length, 2);
  });

  it('départage deux exclusives sans en appliquer deux', () => {
    const r = select([c('a', 'EXCLUSIVE', 0, 1000), c('b', 'EXCLUSIVE', 5, 200)]);
    assert.deepEqual(r.applied.map((x) => x.promotion), ['b']);
    assert.equal(r.excluded[0].reason, 'promo.excluded.otherExclusive');
  });

  it('ne perd aucune promotion en route', () => {
    // Chaque candidate est soit appliquée, soit écartée avec une raison.
    const candidates = [
      c('a', 'NON_STACKABLE', 0, 1000),
      c('b', 'NON_STACKABLE', 0, 2000),
      c('c', 'STACKABLE', 0, 300),
    ];
    const r = select(candidates);
    assert.equal(r.applied.length + r.excluded.length, candidates.length);
  });

  it('ne rend rien quand il n’y a rien', () => {
    assert.deepEqual(select([]), { applied: [], excluded: [], blocksCoupon: false });
  });
});

describe('Bornage de la remise', () => {
  it('ne laisse jamais une remise dépasser sa base', () => {
    // Le cumul de deux promotions légitimes suffit à y arriver.
    assert.equal(cap(D(12_000), D(10_000)).toString(), '10000');
  });

  it('ne rend jamais une remise négative', () => {
    assert.equal(cap(D(-5), D(10_000)).toString(), '0');
  });

  it('laisse passer une remise inférieure à sa base', () => {
    assert.equal(cap(D(2_500), D(10_000)).toString(), '2500');
  });
});
