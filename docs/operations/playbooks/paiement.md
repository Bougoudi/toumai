# Le prestataire de paiement ne répond plus

## Reconnaître

- Les créations de paiement échouent ou expirent.
- `/admin/operations` : `Prestataire · Paiement` hors `OK`.
- Journal : erreurs sortantes vers le prestataire.

## La règle qui prime sur tout

**Ne jamais marquer un paiement réussi sans confirmation du prestataire.** Un
paiement dont on ignore l'issue reste `PENDING`. C'est inconfortable pour
l'acheteur ; le déclarer réussi à tort est bien pire — le vendeur expédie, et
l'argent n'est jamais arrivé.

## Agir

1. Vérifier que c'est le prestataire et non le réseau sortant.
2. Si l'indisponibilité dure, éteindre le moyen de paiement concerné plutôt
   que de laisser des acheteurs échouer au dernier écran : ils repartent en
   pensant que la place de marché ne marche pas.
3. Le paiement à la livraison, là où il est configuré, reste disponible : il
   ne dépend d'aucun prestataire.
4. Au retour, **ne rien rejouer à la main**. Les notifications du prestataire
   rattrapent les paiements aboutis ; l'anti-rejeu par identifiant empêche les
   doubles.

## Après

Les paiements restés en attente au-delà de leur délai sont repris par
l'entretien périodique. Vérifier qu'aucune commande n'est passée en préparation
sans paiement confirmé : `/admin/data-integrity`,
contrôle `ORDER_PAID_WITHOUT_PAYMENT`.
