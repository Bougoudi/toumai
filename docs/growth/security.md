# Sécurité et abus

## Ce qu'un vendeur ne peut pas faire

- **Créer une promotion financée par TOUMA.** `storeId` implique
  `funding: SELLER`, le service ne prend pas le financement en entrée.
- **Toucher la promotion d'un autre.** Un identifiant de boutique valide rend
  `404`, pas `403` : le second confirmerait l'existence d'une boutique qu'on ne
  possède pas.
- **Modifier une promotion de la place de marché** depuis son espace.
- **Réactiver une promotion archivée.** Des commandes s'y réfèrent.
- **Écrire un prix barré.** Le prix de référence est calculé depuis
  l'historique, jamais pris en entrée.

## Ce qu'un acheteur ne peut pas faire

- Cumuler un code avec une promotion exclusive — et le message **nomme la
  promotion** plutôt que de dire « code refusé », sinon il croirait son code
  invalide alors qu'il bénéficie déjà de mieux.
- Se parrainer lui-même, être parrainé deux fois, être récompensé sans commande
  terminée.
- Faire descendre un total sous zéro : la remise est bornée à sa base, une fois,
  au même endroit pour tous les appelants.

## Ce qu'un administrateur ne peut pas faire

- Écrire un score de confiance, un badge ou un prix de référence. Une promotion
  change un prix **au moment du calcul** ; elle ne le remplace jamais en base.
- Créer une campagne visant une province inexistante : le référentiel est
  vérifié, sinon la campagne ne s'appliquerait nulle part sans que personne ne
  le voie.

## Abus de coupon et de parrainage

Les signaux connus (`REFERRAL_SELF`, `REFERRAL_LINKED_ACCOUNTS`) sont consignés
dans le moteur de risque V21. **Le module de croissance ne sanctionne pas** : il
signale, et V21 décide — où la règle « aucun blocage sur le seul cumul de
signaux faibles » continue de s'appliquer.

## Audit

Création et modification d'une promotion, création d'une campagne, création d'un
segment, qualification et récompense d'un parrainage : toutes écrivent dans
`ToumaAuditLog` avec leur auteur.

## Ce que V22 ne touche pas

Une promotion ne modifie **jamais** un score de confiance, un statut de
vérification, un score de risque ni une note d'avis. Elle change un prix
commercial selon des règles, et rien d'autre. C'est le §54, et c'est aussi ce
qui empêche d'acheter de la réputation.
