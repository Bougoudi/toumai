# TOUMA Growth — ce qui bloque la mise en service

## Bloquant : dépend d'une décision

| Ce qui manque | Ce qui est bloqué | Qui décide |
|---|---|---|
| **barème de parrainage** | la récompense reste manuelle | vous |
| **partenaire de cofinancement** | `funding: PARTNER` est refusé | vous |
| **avis juridique** | la durée de référence d'un prix barré (30 j par défaut) | vous |

## Ce qui est écrit mais fermé

| Levier | Drapeau | Mode d'échec |
|---|---|---|
| parrainage | `TOUMA_GROWTH_REFERRALS_ENABLED` | fraude |
| ventes flash | `TOUMA_GROWTH_FLASH_SALES_ENABLED` | survente |
| automatisation | `TOUMA_GROWTH_AUTOMATION_ENABLED` | courriels en rafale |
| tests A/B | `TOUMA_GROWTH_AB_TESTING_ENABLED` | conclusions fausses |

Le parrainage est **complet et testé**. Les trois autres n'ont pour l'instant
que leur drapeau et leur place dans le schéma — ils sont annoncés comme tels
plutôt que présentés comme faits.

## Ce qui n'existe pas encore

- **Ventes flash** : le modèle n'est pas écrit. Une vente flash sans protection
  transactionnelle contre la survente serait pire qu'aucune vente flash.
- **Automatisation marketing** : déclencheurs et actions non implémentés. Les
  préférences de notification existent déjà (V14) et devront être respectées.
- **Tests A/B** : la base n'est pas écrite. Sans elle, aucun ROI n'est mesurable
  — voir `analytics.md`.
- **Bundles et paliers B2B** : les types existent dans l'enum, le calcul par
  paliers s'appuiera sur `ToumaPriceTier`, qui existe déjà.
- **Centres marketing côté interface** : l'API est complète et documentée ; les
  écrans vendeur et administration restent à faire.

## Avant d'ouvrir

```bash
npm test                    # dont growth-rules, growth, growth-loyalty
npm run typecheck
curl localhost:3000/api/v1/products/<slug> | jq '{referencePrice, savings}'
```

La dernière commande doit rendre `null` sur un produit sans historique, quel que
soit son `compareAtPrice`. Si elle rend un prix barré sur un produit dont le
prix n'a jamais bougé, quelque chose ment.
