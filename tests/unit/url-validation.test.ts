import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { urlRetourPaiement, urlWeb } from '../../src/touma/lib/url.js';

/**
 * VALIDATION D'URL (V25 §40).
 *
 * `z.string().url()` s'appuie sur `new URL()`, qui valide la **forme** et ne
 * dit rien du schéma. Dix champs du domaine l'employaient — image de produit,
 * logo de boutique, preuve de litige, site d'entreprise, source d'une règle
 * commerciale, retour de paiement — et acceptaient donc `javascript:`,
 * `data:text/html`, `file://` et `vbscript:`.
 *
 * Deux de ces champs finissent dans un `<a href>`. La source d'un itinéraire
 * de corridor est rendue ainsi sur la vitrine publique, qui n'a pas de
 * politique de sécurité de contenu : un `javascript:` s'y serait exécuté dans
 * le navigateur de chaque visiteur, planté par un administrateur ne disposant
 * que de `ADMIN_TRADE`.
 */

const valide = urlWeb(500);

describe('Schémas refusés', () => {
  it('refuse les schémas exécutables et locaux', () => {
    const dangereux = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'blob:https://exemple.test/abc',
    ];
    for (const v of dangereux) {
      assert.equal(valide.safeParse(v).success, false, `« ${v} » ne doit pas être accepté`);
    }
  });

  it('refuse une adresse portant des identifiants', () => {
    // Elles servent surtout à déguiser un domaine hostile derrière un nom
    // rassurant : `https://banque-connue.test@attaquant.test`.
    assert.equal(valide.safeParse('https://alice:motdepasse@exemple.test/a.jpg').success, false);
    assert.equal(valide.safeParse('https://banque-connue.test@attaquant.test').success, false);
  });

  it('refuse ce qui n’est pas une adresse', () => {
    for (const v of ['', 'pas une adresse', 'https://', '//exemple.test/a.jpg']) {
      assert.equal(valide.safeParse(v).success, false, `« ${v} »`);
    }
  });
});

describe('Ce qui reste accepté', () => {
  it('accepte http et https, avec chemin, port et paramètres', () => {
    for (const v of [
      'https://exemple.test/image.jpg',
      'http://exemple.test/image.jpg',
      'https://exemple.test:8443/a/b.png?v=2#x',
      'https://sous.domaine.exemple.test/photo.webp',
    ]) {
      assert.equal(valide.safeParse(v).success, true, `« ${v} » doit rester accepté`);
    }
  });

  it('fait respecter la longueur maximale', () => {
    assert.equal(urlWeb(60).safeParse(`https://exemple.test/${'a'.repeat(100)}`).success, false);
  });
});

describe('Retour de paiement', () => {
  it('refuse les mêmes schémas que partout ailleurs', () => {
    assert.equal(urlRetourPaiement(500).safeParse('javascript:alert(1)').success, false);
  });

  it('n’est pas restreint tant qu’aucune origine n’est configurée', () => {
    delete process.env.TOUMA_PAYMENT_RETURN_ORIGINS;
    // Rien n'est encore branché : bloquer ici casserait sans rien protéger.
    assert.equal(urlRetourPaiement(500).safeParse('https://nimporte.test/retour').success, true);
  });

  it('s’en tient aux origines listées quand elles existent', () => {
    process.env.TOUMA_PAYMENT_RETURN_ORIGINS = 'https://touma.test,https://app.touma.test';
    try {
      const v = urlRetourPaiement(500);
      assert.equal(v.safeParse('https://touma.test/paiement/retour').success, true);
      assert.equal(v.safeParse('https://app.touma.test/ok').success, true);
      // Une redirection ouverte est le moyen le plus commode de faire atterrir
      // un acheteur sur une fausse page de confirmation.
      assert.equal(v.safeParse('https://attaquant.test/faux-succes').success, false);
      // Un sous-domaine voisin n'est pas la même origine.
      assert.equal(v.safeParse('https://touma.test.attaquant.test/').success, false);
    } finally {
      delete process.env.TOUMA_PAYMENT_RETURN_ORIGINS;
    }
  });

  it('lit la liste à chaque validation, pas une fois au chargement', () => {
    // Le même piège que les plafonds de limitation de débit : une valeur lue à
    // l'import ignore en silence tout ce qui est posé ensuite.
    const v = urlRetourPaiement(500);
    process.env.TOUMA_PAYMENT_RETURN_ORIGINS = 'https://touma.test';
    try {
      assert.equal(v.safeParse('https://ailleurs.test/x').success, false);
    } finally {
      delete process.env.TOUMA_PAYMENT_RETURN_ORIGINS;
    }
  });
});
