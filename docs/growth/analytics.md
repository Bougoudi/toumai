# Analyse des promotions

## Ce qui est mesuré

Pour chaque promotion :

- combien de fois elle s'est appliquée ;
- à combien d'**acheteurs distincts** ;
- sur combien de commandes ;
- ce qu'elle a coûté, **par devise** ;
- l'état de son budget ;
- la date de première application.

Tous ces chiffres sont des décomptes issus de `ToumaPromotionUsage`. Aucun n'est
estimé.

## Ce qui n'est pas mesuré, et pourquoi c'est dit

L'API rend explicitement :

```json
"notMeasured": ["conversionRate", "roi", "incrementalRevenue"]
```

**Taux de conversion, retour sur investissement et revenu incrémental supposent
tous de savoir ce qui serait arrivé sans la promotion.** Personne ne le sait.
Une commande passée pendant une promotion n'a pas été causée par elle : elle
aurait peut-être eu lieu de toute façon, au prix fort.

Publier un ROI construit sur cette confusion orienterait de vraies décisions
commerciales — un vendeur reconduirait une promotion qui ne lui rapporte rien,
ou arrêterait celle qui marche. Mieux vaut ne pas répondre que répondre faux.

Mesurer une causalité demanderait un groupe témoin, donc un test A/B réel. La
base existe (`TOUMA_GROWTH_AB_TESTING_ENABLED`), le dispositif non.

## Les devises ne s'additionnent pas

Un total mélangeant XAF et une autre monnaie sans taux officiel ne veut rien
dire. Les montants sont rendus par devise, y compris sur le tableau de bord
d'administration.

## Comparer avant / pendant / après

Possible depuis `ToumaPromotionUsage` et l'historique de commandes. Un tel
graphique ne doit **pas** être présenté comme une mesure d'effet : une
saisonnalité, une campagne concurrente ou une rupture de stock produisent les
mêmes courbes.
