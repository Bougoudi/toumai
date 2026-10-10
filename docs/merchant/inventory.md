# Stock : le journal des mouvements

> V27 §3. État au 22 septembre 2026.

## Le manque que cela comble

Le stock se modifiait par `UPDATE quantity` depuis **six endroits du code** —
création de produit, correction vendeur, import de catalogue, passage de
commande, libération de réservation, réception de retour. Aucun ne laissait de
trace.

Un vendeur qui constatait un écart n'avait rien à consulter. L'équipe non
plus : le commentaire de l'ancien `reservation-counter.ts` le concédait
explicitement — un contrôle d'intégrité avait trouvé **101 lignes à
`reserved = -1`**, et on ignorait lequel des trois chemins de libération
décrémentait deux fois. La question était insoluble faute de journal.

## Le point de passage unique

Tout passe par `src/touma/inventory/stock.service.ts` :

| Fonction | Usage |
|---|---|
| `creerStock` | création d'un produit ou d'une variante |
| `fixerStock` | le vendeur dit « il y en a 12 » — une correction, pas une variation |
| `prelever` | décrément conditionnel au passage de commande |
| `libererStock` | libération de réservation, avec ou sans remise en stock |

**Un test d'architecture interdit de contourner.** Il balaie `src/` et échoue
si un fichier autre que le service écrit dans `touma_inventory`. Une règle
qu'on doit se rappeler d'appliquer n'est pas une règle ; celle-ci échoue toute
seule. Deux fichiers sont autorisés, et seulement parce qu'ils **lisent** :
les contrôles d'intégrité et les tâches d'IA.

## Ce qui n'a pas changé

`quantity` reste ce qui est vendable. `reserved` reste un compteur de suivi.
Le décrément au passage de commande reste **conditionnel** — la clause
`quantity >= demandée` est le seul verrou qui empêche deux acheteurs
simultanés de prendre le même dernier article, et elle est conservée telle
quelle. V27 ajoute la trace ; il ne touche pas à l'arbitrage.

## `quantityAfter`, le champ qui compte

Chaque mouvement fige l'état **après** application. Cela permet deux choses
qu'un simple delta ne permet pas :

1. rejouer l'histoire d'un article ;
2. **détecter une dérive** — si le dernier mouvement dit 9 et que la table
   d'inventaire dit 11, deux unités sont apparues sans passer par le journal.

Le contrôle d'intégrité `INVENTORY_LEDGER_DRIFT` (sévérité CRITIQUE) fait
exactement cette comparaison. Les lignes créées avant V27 n'ont pas
d'historique et ne sont pas signalées : elles précèdent le journal, elles ne
le contredisent pas.

## La libération de trop, enfin visible

`GREATEST(reserved - n, 0)` rend une libération excédentaire inoffensive. Il
la rendait aussi **invisible**.

Le journal enregistre désormais l'écart **réellement appliqué**, pas celui
demandé. Quand le plancher mord, les deux diffèrent — et le mouvement porte le
motif du chemin qui l'a produit. `liberationExcedentaire()` le détecte en une
comparaison.

C'est la réponse à la question que l'ancien code posait sans pouvoir la
trancher.

## Types de mouvement

`INITIAL` · `SALE` · `RETURN` · `CANCELLATION` · `RESERVATION_RELEASE` ·
`ADJUSTMENT` · `IMPORT` · `PURCHASE` · `TRANSFER_OUT` · `TRANSFER_IN` ·
`DAMAGE` · `LOSS` · `COUNT_CORRECTION`

Les six derniers sont déclarés mais **aucun code ne les émet encore** : ils
attendent les réceptions fournisseur, les transferts entre points de stockage
et les inventaires physiques. Ils figurent parce qu'une énumération est une
donnée de schéma et qu'y revenir coûte une migration ; leur absence d'usage
est dite ici plutôt que découverte.

## Lire le journal

```
GET /api/v1/seller/products/:productId/stock-movements?limit=50&cursor=…
```

Réservé au propriétaire de la boutique. Un mouvement de stock dit combien un
concurrent vend et quand : c'est une donnée commerciale, pas un journal
public. Un produit d'un autre vendeur rend **404**, pas 403 — répondre 403
confirmerait son existence.

## Ce qui n'est pas fait

Le stock n'a **pas** de dimension entrepôt. `ToumaInventory` reste indexé par
`(produit, variante)` : un vendeur ayant du stock à N'Djamena et à Moundou ne
peut pas encore les distinguer. C'est la suite naturelle de ce journal — les
types `TRANSFER_IN` / `TRANSFER_OUT` l'anticipent — mais ce n'est pas livré,
et rien dans l'interface ne laisse croire le contraire.
