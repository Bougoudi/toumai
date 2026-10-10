# Outils

Un outil est la seule façon dont l'assistant touche aux données de Touma.

## Contrat

```ts
{ name, description, inputSchema (zod), risk, surfaces, roles, handler }
```

La `description` est lue par le modèle : elle dit ce que l'outil fait **et ce
qu'il ne fait pas**. « Ne calcule aucun délai de livraison » est aussi utile
que le reste.

## Les trente-quatre outils

*(Le message du commit qui a introduit les premiers en annonce dix-huit :
c'était un mauvais décompte de ma part, pas une liste amputée.)*

| Outil | Risque | Service appelé |
|---|---|---|
| `searchProducts` | READ_ONLY | `productService.list` |
| `getProduct` | READ_ONLY | `productService.get` |
| `compareProducts` | READ_ONLY | `productService.get` + `trustService.get` |
| `checkProvinceAvailability` | READ_ONLY | `geoService` |
| `parseShoppingQuery` | READ_ONLY | analyse locale + `geoService` |
| `listMyOrders` | READ_ONLY | `orderService.list` |
| `getOrder` | READ_ONLY | `orderService.get` |
| `getOrderTracking` | READ_ONLY | `orderService.tracking` |
| `getMyCart` | READ_ONLY | `cartService.get` |
| `getShippingQuote` | READ_ONLY | `logisticsService.quote` |
| `suggestReorder` | READ_ONLY | commandes livrées de l'utilisateur |
| `getSellerTrust` | READ_ONLY | `trustService.get` + `redactForPublic` |
| `getProductReviews` | READ_ONLY | avis publiés |
| `getSalesAnalytics` | READ_ONLY | commandes de la boutique |
| `getInventory` | READ_ONLY | stock et ventes de la boutique |
| `getStoreOverview` | READ_ONLY | `analyticsService.storeStats` |
| `createDraftListing` | LOW_RISK | aucun — rend un brouillon |
| `createDraftRFQ` | LOW_RISK | aucun — rend un brouillon |
| `listMyRFQs` | READ_ONLY | `b2bService.listRfqs` |
| `searchSuppliers` | READ_ONLY | boutiques actives + `trustService` |
| `compareQuotes` | READ_ONLY | `b2bService.getRfq` |
| `escalateToHuman` | LOW_RISK | `supportService.create` |
| `getPlatformOverview` | READ_ONLY | `analyticsService.dashboard` |
| `getOrdersByProvince` | READ_ONLY | `intelligenceService.corridors` |
| `getPaymentReliability` | READ_ONLY | `intelligenceService` |
| `getStockTension` | READ_ONLY | `intelligenceService` |
| `getUnmetDemand` | READ_ONLY | `intelligenceService` |
| `getSellersWithDeliveryIssues` | READ_ONLY | commandes agrégées |
| `getPriceIntelligence` | READ_ONLY | historique de prix + catalogue de la catégorie |
| `getDemandIntelligence` | READ_ONLY | recherches enregistrées + lignes de commande |
| `getSellerBrief` | READ_ONLY | commandes, stock et litiges de la boutique |
| `getPlatformBrief` | READ_ONLY | commandes, comptes, litiges, paiements, recherches |
| `analyseMyCart` | READ_ONLY | panier, catalogue de la catégorie |
| `getRiskReviewQueue` | READ_ONLY | risques de transaction, d'avis et de compte (V21) |

## Ce que l'exécuteur applique

Dans l'ordre : existence de l'outil, surface, rôle, schéma zod, porte de
confirmation, bornes de boucle, exécution, audit.

L'audit est écrit **même sur un refus**. Une tentative d'accès à la commande
d'un autre laisse une trace ; sinon la seule chose qu'on saurait d'une attaque
est qu'elle n'a pas marché.

## Bornes de boucle

- au plus `AI_MAX_TOOL_CALLS` appels par demande (8) ;
- au plus `AI_MAX_RUN_MS` de durée (30 s) ;
- le même outil avec les mêmes arguments au plus deux fois — la troisième ne
  rendra pas une réponse différente.

L'empreinte des arguments (`argsHash`) reconnaît un appel identique sans
conserver les arguments eux-mêmes.
