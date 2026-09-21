# Le transporteur ne répond plus

## Reconnaître

- Les devis d'expédition échouent.
- `/admin/operations` : `Prestataire · Transporteurs` hors `OK`.

## La règle

**Ne jamais afficher un délai ou un tarif inventé.** Quand aucun transporteur
ne répond, l'écran dit « Estimation indisponible ». Un tarif deviné engage un
vendeur sur un coût qu'il devra payer.

## Agir

1. Si d'autres transporteurs sont configurés, ils prennent le relais
   automatiquement — l'estimation retient ce qui répond.
2. Si aucun ne répond, les commandes restent possibles là où le retrait ou le
   paiement à la livraison existent. Le reste attend.
3. Les corridors transfrontaliers dont ce transporteur était le seul deviennent
   **non opérationnels** d'eux-mêmes : la capacité est recalculée à chaque
   lecture, sans intervention. Leurs pages publiques cessent d'être indexables
   et sortent du plan du site.

## Après

Aucune action : rien n'est mis en cache côté corridor.
