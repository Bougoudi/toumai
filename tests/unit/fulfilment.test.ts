import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { groupStatusFrom } from '../../src/touma/orders/group-status.js';
import { resolveUnitPrice, tiersFor } from '../../src/touma/catalog/pricing.js';

/** Palier de test. */
function tier(minQuantity: number, unitPrice: string, currency = 'XAF') {
  return { minQuantity, unitPrice: new Prisma.Decimal(unitPrice), currency };
}

describe('Statut d’une commande multi-vendeurs', () => {
  it('suit ses vendeurs quand ils sont au même endroit', () => {
    assert.equal(groupStatusFrom(['PENDING', 'PENDING']), 'PENDING');
    assert.equal(groupStatusFrom(['PAID', 'PAID']), 'PAID');
    assert.equal(groupStatusFrom(['PROCESSING', 'PROCESSING']), 'PROCESSING');
    assert.equal(groupStatusFrom(['DELIVERED', 'DELIVERED']), 'DELIVERED');
    assert.equal(groupStatusFrom(['COMPLETED', 'COMPLETED']), 'COMPLETED');
  });

  it('nomme l’écart plutôt que de le masquer', () => {
    // Le défaut corrigé : cette commande affichait « payée » alors qu'un colis
    // était déjà parti et l'autre pas.
    assert.equal(groupStatusFrom(['SHIPPED', 'PROCESSING']), 'PARTIALLY_SHIPPED');
    assert.equal(groupStatusFrom(['DELIVERED', 'SHIPPED']), 'PARTIALLY_DELIVERED');
    assert.equal(groupStatusFrom(['DELIVERED', 'DELIVERED', 'IN_TRANSIT']), 'PARTIALLY_DELIVERED');
  });

  it('traite « expédié » et « en transit » comme la même étape pour l’acheteur', () => {
    // Du point de vue de l'acheteur, le colis est parti : l'un est la version
    // détaillée de l'autre, et présenter « partiellement expédiée » ici serait
    // du bruit.
    assert.equal(groupStatusFrom(['SHIPPED', 'IN_TRANSIT']), 'SHIPPED');
  });

  it('ne compte pas un vendeur qui annule comme un vendeur en retard', () => {
    // Deux vendeurs livrent, le troisième annule : la commande est livrée.
    assert.equal(groupStatusFrom(['DELIVERED', 'DELIVERED', 'CANCELLED']), 'DELIVERED');
    assert.equal(groupStatusFrom(['PROCESSING', 'CANCELLED']), 'PROCESSING');
  });

  it('n’est annulée que lorsqu’il ne reste plus rien', () => {
    assert.equal(groupStatusFrom(['CANCELLED', 'CANCELLED']), 'CANCELLED');
    assert.equal(groupStatusFrom(['REFUNDED', 'CANCELLED']), 'REFUNDED');
    assert.equal(groupStatusFrom([]), 'PENDING');
  });

  it('ne laisse pas un litige effacer l’avancement', () => {
    // Un litige se lit ailleurs : il ne remet pas la logistique à zéro.
    assert.equal(groupStatusFrom(['DELIVERED', 'DISPUTED']), 'DELIVERED');
    assert.equal(groupStatusFrom(['DISPUTED']), 'PROCESSING');
  });
});

describe('Paliers de prix B2B', () => {
  const grille = [tier(10, '2800'), tier(100, '2600'), tier(500, '2400')];
  const prixCatalogue = new Prisma.Decimal('3000');

  it('applique le palier correspondant à la quantité réellement commandée', () => {
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 5, grille).unitPrice.toString(), '3000');
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 10, grille).unitPrice.toString(), '2800');
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 99, grille).unitPrice.toString(), '2800');
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 100, grille).unitPrice.toString(), '2600');
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 10_000, grille).unitPrice.toString(), '2400');
  });

  it('garde la trace de ce qui a déterminé le prix', () => {
    const resultat = resolveUnitPrice(prixCatalogue, 'XAF', 120, grille);
    assert.deepEqual(resultat.appliedTier, { minQuantity: 100, unitPrice: '2600' });
    assert.equal(resultat.listPrice.toString(), '3000');

    // Sans palier applicable, rien n'est inventé.
    assert.equal(resolveUnitPrice(prixCatalogue, 'XAF', 2, grille).appliedTier, null);
  });

  it('ne laisse jamais un palier augmenter le prix', () => {
    // Une erreur de saisie ne doit pas se retourner contre l'acheteur : il paie
    // le prix affiché.
    const piege = [tier(10, '3500')];
    const resultat = resolveUnitPrice(prixCatalogue, 'XAF', 50, piege);
    assert.equal(resultat.unitPrice.toString(), '3000');
    assert.equal(resultat.appliedTier, null);
  });

  it('refuse de mélanger les devises', () => {
    assert.throws(() => resolveUnitPrice(prixCatalogue, 'XAF', 50, [tier(10, '4', 'EUR')]), /devise/i);
  });

  it('ne retient que les paliers qui concernent la ligne', () => {
    const tous = [
      { ...tier(10, '2800'), variantId: null },
      { ...tier(10, '2500'), variantId: 'var_rouge' },
    ];
    // Ligne sans variante : seuls les paliers du produit s'appliquent.
    assert.equal(tiersFor(tous, null).length, 1);
    // Ligne d'une variante : les siens, plus ceux du produit.
    assert.equal(tiersFor(tous, 'var_rouge').length, 2);
    // Une autre variante ne récupère pas le palier de sa voisine.
    assert.equal(tiersFor(tous, 'var_bleu').length, 1);
    assert.equal(tiersFor(undefined, null).length, 0);
  });
});
