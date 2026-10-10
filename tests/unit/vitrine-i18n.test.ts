import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeCorridorStatus, TradeDocumentKind } from '@prisma/client';
import { CODES_BLOCAGE } from '../../src/touma/trade/corridor-blocages.js';
import {
  DICTIONNAIRES,
  LANGUES,
  type Cle,
  type Langue,
  chemin,
  nomPays,
  t,
} from '../../apps/web/lib/i18n.js';

/**
 * La vitrine bilingue (§62).
 *
 * La parité des clés est déjà garantie à la compilation : `AR` est typé
 * `Record<Cle, string>`. Ce que le typage ne peut pas voir, c'est si l'arabe
 * est bien de l'arabe, et si les deux langues intercalent les mêmes valeurs.
 * C'est exactement là que se logent les traductions à trous.
 */
describe('Vitrine — français et arabe', () => {
  const cles = Object.keys(DICTIONNAIRES.fr) as Cle[];

  it('chaque libellé arabe est écrit en caractères arabes', () => {
    // Une valeur recopiée du français passerait le contrôle de typage sans
    // qu'aucune alerte ne se déclenche : elle a bien le type `string`.
    for (const cle of cles) {
      const valeur = DICTIONNAIRES.ar[cle];
      assert.match(valeur, /[؀-ۿ]/, `${cle} : aucun caractère arabe — « ${valeur} »`);
    }
  });

  it('aucun libellé arabe n’est resté en français', () => {
    for (const cle of cles) {
      assert.notEqual(DICTIONNAIRES.ar[cle], DICTIONNAIRES.fr[cle], `${cle} : arabe identique au français`);
    }
  });

  /**
   * Le défaut qui ne se voit pas en relisant. Si le français écrit
   * « {min} à {max} jours » et que l'arabe oublie `{max}`, la page arabe
   * affiche un délai amputé — une donnée fausse, pas une maladresse de style.
   */
  it('les deux langues intercalent exactement les mêmes valeurs', () => {
    const parametres = (texte: string) => [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const cle of cles) {
      assert.deepEqual(
        parametres(DICTIONNAIRES.ar[cle]),
        parametres(DICTIONNAIRES.fr[cle]),
        `${cle} : paramètres différents entre les deux langues`,
      );
    }
  });

  it('aucun libellé n’est vide', () => {
    for (const langue of LANGUES) {
      for (const cle of cles) {
        assert.ok(DICTIONNAIRES[langue][cle].trim().length > 0, `${langue}/${cle} : libellé vide`);
      }
    }
  });

  /**
   * Un code d'énumération sans libellé s'afficherait brut au milieu d'une
   * page — `CERTIFICATE_OF_ORIGIN` sur une fiche de corridor. Ajouter une
   * valeur à Prisma sans la traduire doit faire échouer ce test.
   */
  it('toutes les valeurs Prisma affichées par la vitrine sont traduites', () => {
    for (const langue of LANGUES) {
      for (const valeur of Object.values(TradeDocumentKind)) {
        assert.ok(`doc.${valeur}` in DICTIONNAIRES[langue], `${langue} : doc.${valeur} manquant`);
      }
      for (const valeur of Object.values(TradeCorridorStatus)) {
        assert.ok(`statutCorridor.${valeur}` in DICTIONNAIRES[langue], `${langue} : statutCorridor.${valeur} manquant`);
      }
      // Les motifs de blocage viennent du serveur : la vitrine doit couvrir
      // tous ceux qu'il sait émettre, sans quoi une page arabe afficherait un
      // code là où elle devrait expliquer pourquoi un corridor est fermé.
      for (const code of CODES_BLOCAGE) {
        assert.ok(`blocage.${code}` in DICTIONNAIRES[langue], `${langue} : blocage.${code} manquant`);
      }
    }
  });

  it('les adresses françaises ne bougent pas, l’arabe vit sous /ar', () => {
    // Déplacer le français sous /fr casserait les URL canoniques, le plan du
    // site et tout lien déjà partagé, pour un gain nul.
    assert.equal(chemin('fr', '/'), '/');
    assert.equal(chemin('fr', '/produits'), '/produits');
    assert.equal(chemin('fr', '/trade/tchad-cameroun'), '/trade/tchad-cameroun');
    assert.equal(chemin('ar', '/'), '/ar');
    assert.equal(chemin('ar', '/produits'), '/ar/produits');
    assert.equal(chemin('ar', '/trade/tchad-cameroun'), '/ar/trade/tchad-cameroun');
  });

  it('un nom de pays inconnu retombe sur celui du serveur, jamais sur une invention', () => {
    assert.equal(nomPays('ar', 'TD', 'Tchad'), 'تشاد');
    assert.equal(nomPays('fr', 'TD', 'Tchad'), 'Tchad');
    // Pays hors table : on préfère le nom français du serveur à une
    // translittération fabriquée.
    assert.equal(nomPays('ar', 'ZZ', 'Pays inconnu'), 'Pays inconnu');
    assert.equal(nomPays('ar', 'ZZ', null), 'ZZ');
  });

  it('un paramètre manquant reste visible plutôt que de disparaître', () => {
    // Afficher « {max} » est laid ; afficher un délai amputé est faux. On
    // choisit le laid, qui se remarque et se corrige.
    for (const langue of LANGUES satisfies readonly Langue[]) {
      assert.match(t(langue, 'corridor.delaiAnnonce', { min: 3 }), /\{max\}/);
      assert.doesNotMatch(t(langue, 'corridor.delaiAnnonce', { min: 3, max: 7 }), /\{|\}/);
    }
  });
});
