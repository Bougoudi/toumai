# Segmentation

## Ce que le moteur lit

Trois faits commerciaux : le **nombre de commandes**, le **montant dépensé**, la
**date du dernier achat**.

## Ce qu'il ne lit pas, et comment on le sait

Ni religion, ni origine, ni appartenance politique, ni genre. Ni nom, ni
adresse, ni pays.

La garantie n'est pas une promesse écrite en commentaire : c'est que **la
requête ne sélectionne pas ces colonnes**. Une donnée qui n'est pas lue ne peut
pas entrer dans un segment, et il suffit de regarder le `select` pour s'en
assurer. Un test vérifie ce `select` et échoue si l'une de ces colonnes y
apparaît.

Le pays n'y figure pas non plus : il sert à livrer et à facturer, il n'a rien à
faire dans une catégorie de personnes.

## Les conditions

`minOrders` · `maxOrders` · `minSpend` + `spendCurrency` ·
`minDaysSinceLastOrder` · `maxDaysSinceLastOrder`

Toutes facultatives, toutes cumulatives.

### Deux refus

- **Un seuil de montant sans devise n'est jamais rempli.** Il ne veut rien dire,
  et il ne doit pas être rempli par hasard.
- **Qui n'a jamais commandé n'a pas d'« ancienneté du dernier achat ».** La
  remplacer par l'infini rangerait tout nouveau venu parmi les clients perdus.

Les dépenses sont comptées **par devise**, jamais additionnées : il n'existe pas
de taux officiel ici, et un total mélangé ne voudrait rien dire.

## L'appartenance est justifiée

Chaque appartenance est consignée avec les chiffres qui l'ont produite et la
date du calcul. « Pourquoi suis-je dans ce segment » doit avoir une réponse,
sinon la segmentation devient une étiquette qu'on ne peut pas contester.

Quand la condition cesse d'être vraie, l'appartenance est **retirée**.

## Dégradation

Si le calcul échoue, `segmentsOf()` rend une liste vide plutôt qu'une erreur :
une segmentation indisponible ne doit pas empêcher un achat. Les promotions qui
en dépendent ne s'appliquent simplement pas.
