# Ventes flash

**Fermé par défaut** (`TOUMA_GROWTH_FLASH_SALES_ENABLED=false`).

## Le seul risque qui compte

Annoncer cent unités à prix cassé et en vendre cent trente, c'est devoir annuler
trente commandes déjà payées — et perdre trente acheteurs qui avaient eu raison
de faire confiance.

**Une vente flash ratée coûte plus cher que pas de vente flash.** C'est pourquoi
le levier reste fermé jusqu'à ce que quelqu'un décide de l'exploiter.

## Trois protections, aucune dans le service

1. **La réservation est un `UPDATE` conditionnel.**

   ```sql
   UPDATE touma_flash_sales
      SET reserved = reserved + :q
    WHERE id = :id AND status = 'ACTIVE'
      AND (reserved + :q) <= "quantityLimit"
   ```

   `reserved` n'est jamais lu puis réécrit. Zéro ligne modifiée signifie « il
   n'en reste pas assez ». Deux acheteurs simultanés ne peuvent pas prendre la
   même dernière unité.

   Vérifié : vingt acheteurs simultanés sur cinq unités → exactement cinq
   réservations, `reserved = 5`, cinq lignes consignées.

2. **La limite par acheteur est une contrainte d'unicité en base**
   (`(flashSaleId, userId)`). Dans un service, elle ne tiendrait pas quand le
   même acheteur ouvre deux onglets. L'échec d'insertion annule la transaction
   — donc aussi la réservation faite juste avant, ce qui évite qu'une tentative
   refusée consomme une unité.

3. **Le stock réel reste au tunnel de commande**, qui porte déjà sa garde
   `quantity >= q`. La vente flash borne ce qui est *offert au prix réduit* ;
   elle ne remplace pas le stock.

## Ce que l'API ne montre pas

Une vente **épuisée** n'est pas rendue. Afficher un prix qu'on ne peut plus
obtenir est pire que ne rien afficher : l'acheteur clique, puis découvre autre
chose.

Une vente **hors fenêtre** non plus, dans les deux sens.

`remaining` n'est jamais négatif.

## Ce qui est refusé à la création

- **Un prix supérieur ou égal au prix courant.** Ce ne serait pas une vente
  flash, ce serait une annonce trompeuse.
- **Deux ventes qui se chevauchent sur le même produit.** Elles donneraient deux
  prix différents au même instant.
- **La boutique d'un autre vendeur** — `404`, pas `403` : le second
  confirmerait l'existence d'une boutique qu'on ne possède pas.

Une vente naît en **brouillon**. Publier est un second geste.

## Réservation abandonnée

`release()` rend les unités quand la commande ne s'est pas faite. Sans cela, un
panier abandonné retirerait des unités pour toujours, et la vente afficherait
« épuisée » avec du stock en réserve.

Le décrément passe par `GREATEST(0, …)` : même si un décompte avait dérivé, on
ne descend jamais sous zéro — une réservation négative ferait vendre plus que la
limite, exactement ce qu'on cherche à empêcher.

Une réservation **déjà rattachée à une commande** ne se libère pas.

## Entretien

`closeExpired()` tourne chaque minute et fait passer à `ENDED` les ventes dont
la fenêtre est close. Sans effet sur ce qui se vend — les lectures filtrent déjà
par date — mais une vente laissée « active » encombre les écrans et fausse les
décomptes du vendeur.

## Ce qui n'est pas branché

Le tunnel de commande **n'applique pas encore** le prix flash : le service sait
réserver et rendre le prix, mais `checkout.service.ts` ne l'appelle pas. Tant
que le drapeau est fermé, cela ne change rien pour personne ; c'est la première
chose à faire le jour où il s'ouvre, et c'est écrit ici plutôt que sous-entendu.
