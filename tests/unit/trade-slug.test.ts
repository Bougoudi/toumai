import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeCorridorStatus, TradeDocumentKind } from '@prisma/client';
import { corridorSlug, slugPays } from '../../src/touma/trade/corridor.service.js';
import { LIBELLES_DOCUMENT, LIBELLES_STATUT_CORRIDOR, libelle } from '../../apps/web/lib/libelles.js';

/**
 * Adresses lisibles des corridors (§61).
 *
 * Ces adresses partent dans un plan de site et dans des liens que des moteurs
 * de recherche garderont longtemps. Une règle de fabrication qui change, ou une
 * vitrine qui la recalcule autrement que le serveur, casse des URL déjà
 * indexées — un dégât qu'aucune erreur d'exécution ne signale.
 */

describe('Adresse lisible d’un pays', () => {
  it('retire les accents plutôt que de les laisser dans l’URL', () => {
    assert.equal(slugPays('Sénégal'), 'senegal');
    assert.equal(slugPays('Tchad'), 'tchad');
  });

  it('remplace apostrophes et espaces par un tiret unique', () => {
    assert.equal(slugPays("Côte d'Ivoire"), 'cote-d-ivoire');
    assert.equal(slugPays('  Guinée   équatoriale  '), 'guinee-equatoriale');
  });

  it('ne laisse jamais de tiret au bord', () => {
    assert.equal(slugPays('— Tchad —'), 'tchad');
  });

  it('rend une chaîne vide quand le nom ne contient aucun caractère latin', () => {
    // Un nom écrit uniquement en arabe ne laisse rien : c'est au corridor de
    // retomber sur le code pays, pas au slug d'inventer des lettres.
    assert.equal(slugPays('تشاد'), '');
  });
});

describe('Adresse lisible d’un corridor', () => {
  it('compose les deux noms dans le sens du corridor', () => {
    assert.equal(corridorSlug('Tchad', 'Cameroun', 'TD', 'CM'), 'tchad-cameroun');
    assert.equal(corridorSlug('Cameroun', 'Tchad', 'CM', 'TD'), 'cameroun-tchad');
  });

  it('retombe sur le code pays quand le nom manque', () => {
    assert.equal(corridorSlug(null, 'Cameroun', 'TD', 'CM'), 'td-cameroun');
    assert.equal(corridorSlug('Tchad', undefined, 'TD', 'CM'), 'tchad-cm');
    assert.equal(corridorSlug(null, null, 'TD', 'CM'), 'td-cm');
  });

  it('retombe sur le code quand le nom ne produit aucune lettre', () => {
    // Sans ce repli, l'adresse serait « -cameroun » : un lien mort.
    assert.equal(corridorSlug('تشاد', 'Cameroun', 'TD', 'CM'), 'td-cameroun');
  });
});

/**
 * La vitrine publique ne peut pas charger le dictionnaire de l'application —
 * c'est un module de navigateur. Elle double donc quelques libellés, et un
 * doublon se périme en silence. Ce test est le seul endroit où l'oubli se voit.
 */
describe('Libellés doublés par la vitrine', () => {
  it('couvre tous les types de documents commerciaux', () => {
    const manquants = Object.values(TradeDocumentKind).filter((k) => !(k in LIBELLES_DOCUMENT));
    assert.deepEqual(manquants, [], `types de documents sans libellé dans la vitrine : ${manquants.join(', ')}`);
  });

  it('couvre tous les statuts de corridor', () => {
    const manquants = Object.values(TradeCorridorStatus).filter((s) => !(s in LIBELLES_STATUT_CORRIDOR));
    assert.deepEqual(manquants, [], `statuts de corridor sans libellé dans la vitrine : ${manquants.join(', ')}`);
  });

  it('rend le code brut plutôt qu’un libellé inventé', () => {
    assert.equal(libelle(LIBELLES_DOCUMENT, 'COMMERCIAL_INVOICE'), 'Facture commerciale');
    assert.equal(libelle(LIBELLES_DOCUMENT, 'TYPE_INCONNU'), 'TYPE_INCONNU');
  });
});
