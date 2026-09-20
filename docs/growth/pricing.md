# Intégrité des prix

## Le défaut trouvé

`ToumaProduct.compareAtPrice` est un champ **saisi librement par le vendeur**,
et l'import CSV accepte des colonnes `prix_barre` / `ancien_prix`. La fiche
produit l'affichait barré tel quel.

Autrement dit : n'importe quel chiffre pouvait être déclaré comme « ancien
prix », en masse, et s'afficher comme une économie sur une page publique. Rien
ne le vérifiait, et rien ne pouvait le vérifier — l'information n'existait nulle
part.

Ce n'est pas une maladresse d'affichage. « 25 000 → 20 000, économisez 5 000 »
est une **affirmation commerciale** ; invérifiable, c'est un mensonge.

## La règle

Un prix de référence n'est affichable que s'il a été **réellement pratiqué** :

- plus élevé que le prix actuel ;
- dans la **même devise** ;
- pendant au moins `TOUMA_GROWTH_REFERENCE_PRICE_MIN_DAYS` jours (30 par
  défaut) consécutifs ;
- au cours des douze derniers mois.

Sinon, la fiche n'affiche **rien** : ni barré, ni économie. Ne rien dire vaut
mieux qu'annoncer une économie qu'on ne peut pas justifier.

Sans la durée minimale, il suffirait de monter un prix une heure pour annoncer
une remise le lendemain.

## Ce que l'API rend

```json
{
  "price": "20000",
  "compareAtPrice": "99000",
  "referencePrice": { "amount": "25000", "currency": "XAF",
                      "since": "…", "heldDays": 88 },
  "savings": "5000"
}
```

`compareAtPrice` reste rendu : c'est la déclaration du vendeur, utile sur son
propre écran. Il n'est plus ce que la fiche publique barre.

`referencePrice` porte **depuis quand** et **combien de temps** — c'est ce qui
rend l'affirmation vérifiable par quiconque la conteste.

## L'historique

`ToumaProductPriceHistory` est écrit dans la **même transaction** que le
produit, à la création comme au changement de prix. Un prix qui change sans
laisser de trace rend impossible toute justification ultérieure.

Un enregistrement qui ne change rien n'écrit pas de ligne : une histoire
lisible, pas une ligne par clic sur « enregistrer ».

## Ce que ce document ne tranche pas

Plusieurs droits de la consommation imposent une règle de ce genre. Ici, elle
est appliquée **parce qu'elle est juste**, pas parce qu'un texte l'impose au
Tchad : aucune vérification de ce point n'a été faite. La question rejoint
celles de `docs/payments/compliance-boundaries.md`.
