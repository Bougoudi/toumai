# Mettre un corridor en service

## Ce que le code peut vérifier, et ce qu'il ne peut pas

Le moteur vérifie ce qui est vérifiable **en base** : un corridor existe, les
deux pays sont ouverts au commerce, un moyen de paiement est disponible des
deux côtés, un transporteur réel couvre les deux pays. C'est déjà ce qui
empêche d'activer un corridor vide.

Il ne peut rien dire du reste. Un contrat signé avec un transporteur, une
autorisation d'un régulateur, une procédure de support, une revue juridique :
rien de cela ne se lit dans une base de données, et prétendre le contraire
serait la pire forme de fausse conformité.

D'où cette liste, qui est une liste **humaine**.

## Avant d'activer

### Ce que le moteur vérifie pour vous

- [ ] Configuration commerciale des deux pays (`PUT /admin/trade/countries/:code`)
- [ ] Corridor créé dans **les deux sens** si les deux sont voulus
- [ ] Devises déclarées sur le corridor
- [ ] Moyen de paiement disponible des deux côtés
- [ ] Transporteur **réel** couvrant les deux pays — un adaptateur de
      simulation ne compte pas et le refus le dira

Si `PATCH /admin/trade/corridors/:id` avec `status: ACTIVE` est refusé, le
message nomme précisément ce qui manque.

### Ce que personne d'autre que vous ne peut vérifier

**Prestataires**
- [ ] Contrat signé avec le prestataire de paiement, pour **ce corridor**
- [ ] Contrat signé avec le transporteur, pour **ce corridor**
- [ ] Essais en bac à sable réellement passés, des deux côtés
- [ ] Webhooks reçus et vérifiés en signature
- [ ] Procédure de remboursement éprouvée, y compris en devise différente

**Change**
- [ ] Source de taux identifiée et contractualisée, si les devises diffèrent
- [ ] Qui met à jour le taux, à quelle fréquence, sous quelle responsabilité

**Conformité**
- [ ] Règles saisies, **sourcées**, relues et datées
- [ ] Documents exigés par le corridor, confirmés auprès d'une autorité
- [ ] Restrictions produit connues, vérifiées auprès d'une source officielle
- [ ] Revue juridique du corridor

**Exploitation**
- [ ] Procédure de support : qui répond quand un colis s'arrête à la frontière
- [ ] Procédure de rapprochement financier
- [ ] Supervision : qui regarde les taux d'échec, à quelle fréquence
- [ ] Procédure de retour arrière : comment suspendre le corridor en urgence

**Épreuve réelle**
- [ ] Au moins une transaction pilote de bout en bout, avec de vraies
      marchandises et de vrais documents
- [ ] Au moins un remboursement réellement effectué
- [ ] Au moins un incident d'acheminement réellement traité

## Ce qui reste faux tant que ce n'est pas fait

Un corridor `ACTIVE` dont la liste ci-dessus n'est pas cochée est un corridor
qui **passe la vérification technique** et promet néanmoins ce que personne
n'a contractuellement accepté de tenir.

Le code ne peut pas vous en empêcher. Il peut seulement refuser d'activer un
corridor vide, ce qu'il fait, et rendre visible ce qui manque, ce qu'il fait
aussi.

## Suspendre

`PATCH /admin/trade/corridors/:id` avec `status: SUSPENDED`. Effet immédiat :
l'éligibilité rend `NOT_ELIGIBLE` avec le motif. Les commandes déjà en cours
suivent leur chemin — suspendre un corridor n'annule rien de ce qui est déjà
parti.

## Tchad ↔ Cameroun

Le corridor pilote n'est **pas activé** dans ce dépôt, et aucun script de
déploiement ne l'active. Il n'existe ni prestataire de paiement, ni
transporteur, ni source de change réellement raccordés. Le déclarer actif
reviendrait à promettre à un acheteur de N'Djamena une livraison depuis Douala
que personne n'a accepté de faire.
