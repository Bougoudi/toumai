import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assemble, clamp01, levelFor, type Measure } from '../../src/touma/trust/scoring.js';
import { decayFactor, SELLER_FACTORS, BUYER_FACTORS, SUPPLIER_FACTORS, PRODUCT_FACTORS } from '../../src/touma/trust/weights.js';

/**
 * Le score de confiance décide de ce qu'un acheteur croit d'un vendeur. Il ne
 * suffit pas qu'il « marche » : il faut qu'aucune de ses propriétés ne puisse
 * dériver en silence. Ces contrôles portent donc sur les propriétés, pas sur
 * des valeurs attendues au chiffre près.
 */
const mesure = (value: number | null, detail: Record<string, unknown> = {}): Measure => ({ value, detail });

const toutesMesures = (factors: typeof SELLER_FACTORS, value: number) =>
  Object.fromEntries(factors.map((f) => [f.code, mesure(f.direction === 'POSITIVE' ? value : 0)]));

describe('Score de confiance — pondérations', () => {
  it('publie des composantes positives qui somment à 100', () => {
    // Un vendeur parfait doit pouvoir atteindre 100, sinon le maximum affiché
    // est un plafond invisible que personne ne peut atteindre ni comprendre.
    for (const factors of [SELLER_FACTORS, BUYER_FACTORS, SUPPLIER_FACTORS, PRODUCT_FACTORS]) {
      const positifs = factors.filter((f) => f.direction === 'POSITIVE').reduce((a, f) => a + f.weight, 0);
      assert.equal(positifs, 100, `les composantes positives somment à ${positifs}`);
    }
  });

  it('déclare les pénalités avec un poids négatif', () => {
    for (const factors of [SELLER_FACTORS, BUYER_FACTORS, SUPPLIER_FACTORS, PRODUCT_FACTORS]) {
      for (const f of factors) {
        if (f.direction === 'NEGATIVE') assert.ok(f.weight < 0, `${f.code} devrait être négatif`);
        else assert.ok(f.weight > 0, `${f.code} devrait être positif`);
      }
    }
  });
});

describe('Score de confiance — assemblage', () => {
  it('donne 100 à un dossier parfait', () => {
    const { score } = assemble(SELLER_FACTORS, toutesMesures(SELLER_FACTORS, 1));
    assert.equal(score, 100);
  });

  it('donne 0 quand rien n’est acquis', () => {
    const { score } = assemble(SELLER_FACTORS, toutesMesures(SELLER_FACTORS, 0));
    assert.equal(score, 0);
  });

  it('ne pénalise pas une composante positive qu’on n’a pas pu mesurer', () => {
    // Un vendeur sans conversation n'a pas « 0 de réactivité » : il n'est pas
    // noté dessus. Compter un zéro reviendrait à inventer une mauvaise note.
    const mesures = toutesMesures(SELLER_FACTORS, 1);
    delete mesures.RESPONSIVENESS;
    const { score, components } = assemble(SELLER_FACTORS, mesures);
    assert.equal(score, 100, 'une composante absente ne doit pas faire baisser le score');
    assert.equal(components.find((c) => c.code === 'RESPONSIVENESS')?.value, null);
    assert.equal(components.find((c) => c.code === 'RESPONSIVENESS')?.points, 0);
  });

  it('fait vraiment baisser le score quand une pénalité s’applique', () => {
    // Le contraire serait le pire défaut possible : une pénalité affichée qui
    // ne pénalise rien.
    const parfait = assemble(SELLER_FACTORS, toutesMesures(SELLER_FACTORS, 1)).score;
    const mesures = toutesMesures(SELLER_FACTORS, 1);
    mesures.DISPUTES = mesure(1, { disputeRate: 0.4 });
    const avecLitiges = assemble(SELLER_FACTORS, mesures).score;
    assert.ok(avecLitiges < parfait, `${avecLitiges} devrait être sous ${parfait}`);
    assert.equal(avecLitiges, 85);
  });

  it('n’augmente pas les autres pénalités quand l’une n’est pas mesurée', () => {
    // Si les pénalités étaient renormalisées comme les composantes positives,
    // l'absence d'un signal de fraude alourdirait les litiges — punir plus
    // fort pour moins de faits.
    const base = toutesMesures(SELLER_FACTORS, 1);
    base.DISPUTES = mesure(1);
    const avecFraudeMesuree = assemble(SELLER_FACTORS, { ...base, FRAUD_SIGNALS: mesure(0) }).score;
    const sansFraudeMesuree = assemble(SELLER_FACTORS, { ...base, FRAUD_SIGNALS: mesure(null) }).score;
    assert.equal(avecFraudeMesuree, sansFraudeMesuree);
  });

  it('reste borné entre 0 et 100 malgré une mesure aberrante', () => {
    const haut = assemble(SELLER_FACTORS, toutesMesures(SELLER_FACTORS, 5)).score;
    assert.equal(haut, 100);
    const mesures = toutesMesures(SELLER_FACTORS, 0);
    mesures.FRAUD_SIGNALS = mesure(10);
    assert.equal(assemble(SELLER_FACTORS, mesures).score, 0);
  });

  it('accompagne chaque composante de ce qui l’a produite', () => {
    // C'est l'exigence de V21 : jamais « Score = 87 » tout seul.
    const mesures = toutesMesures(SELLER_FACTORS, 1);
    mesures.DELIVERY = mesure(0.97, { delivered: 142, onTime: 138 });
    const { components } = assemble(SELLER_FACTORS, mesures);
    const livraison = components.find((c) => c.code === 'DELIVERY');
    assert.deepEqual(livraison?.detail, { delivered: 142, onTime: 138 });
    assert.equal(components.length, SELLER_FACTORS.length, 'toutes les composantes sont rendues, même à zéro');
  });
});

describe('Score de confiance — paliers', () => {
  it('distingue « pas encore mesurable » d’un mauvais score', () => {
    // Un vendeur nouveau n'est pas un mauvais vendeur.
    assert.equal(levelFor(null), 'INSUFFICIENT_DATA');
    assert.equal(levelFor(0), 'LOW');
  });

  it('classe aux seuils exacts', () => {
    assert.equal(levelFor(85), 'EXCELLENT');
    assert.equal(levelFor(84), 'GOOD');
    assert.equal(levelFor(70), 'GOOD');
    assert.equal(levelFor(69), 'MODERATE');
    assert.equal(levelFor(50), 'MODERATE');
    assert.equal(levelFor(49), 'LOW');
  });
});

describe('Décroissance temporelle', () => {
  const jours = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('compte un fait du jour à plein poids', () => {
    assert.equal(decayFactor(new Date()), 1);
  });

  it('compte un fait vieux d’une demi-vie pour moitié', () => {
    const f = decayFactor(jours(180));
    assert.ok(Math.abs(f - 0.5) < 0.01, `attendu ~0,5, obtenu ${f}`);
  });

  it('cesse de compter au-delà de l’horizon, sans effacer la trace', () => {
    // Le poids tombe à zéro ; la ligne d'historique, elle, reste en base.
    assert.equal(decayFactor(jours(731)), 0);
  });

  it('décroît de façon monotone', () => {
    let precedent = 1;
    for (const age of [1, 30, 90, 180, 365, 720]) {
      const f = decayFactor(jours(age));
      assert.ok(f <= precedent, `la décroissance remonte à ${age} jours`);
      precedent = f;
    }
  });

  it('ne dépasse jamais 1 pour un fait daté du futur', () => {
    assert.equal(decayFactor(new Date(Date.now() + 86_400_000)), 1);
  });
});

describe('Bornage', () => {
  it('ramène dans [0, 1]', () => {
    assert.equal(clamp01(-3), 0);
    assert.equal(clamp01(0.42), 0.42);
    assert.equal(clamp01(7), 1);
  });
});
