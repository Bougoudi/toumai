# TOUMA Growth — architecture

## Ce qui existait, et qui n'a pas été refait

V22 n'a pas créé un moteur de remise : il en existait un.

- `coupon.service.ts` (V18) porte une **fonction pure** de calcul, le
  financement tracé (`PLATFORM` / `STORE`), une répartition multi-boutiques au
  centime près, les limites par acheteur, le plafond de remise et la règle
  « première commande ».
- `loyalty.service.ts` porte les points, leur gain à la livraison et leur
  reprise au remboursement.
- `ToumaNotificationPreference` porte déjà les préférences par catégorie.

Les dupliquer aurait produit **deux moteurs divergents sur le même panier**, et
la question « lequel est le bon ? » n'a pas de bonne réponse.

## Ce que V22 ajoute

| Brique | Ce qui manquait |
|---|---|
| `ToumaPromotion` | une remise **sans code**, déclenchée par le panier |
| `rules.ts` | des conditions composables, en structure |
| `stacking.ts` | que faire quand deux remises se rencontrent |
| `ToumaPromotionBudget` | arrêter une campagne plutôt que la laisser courir |
| `price-history.ts` | rendre un prix barré **vérifiable** |
| `referral.service.ts` | parrainage, fermé par défaut |
| `segmentation.service.ts` | segments calculés sur des faits commerciaux |

## Le chemin d'une remise

```
   panier
     │
     ▼
   promotionService.evaluateCart()      ← automatique, sans code
     │  règles (rules.ts)  →  applicable ? sinon la raison est rendue
     │  cumul (stacking.ts) → exclusive > une non-cumulable > cumulables
     ▼
   couponService.computeDiscount()      ← seulement si aucune exclusive
     │
     ▼
   loyaltyService.usablePoints()
     │
     ▼
   commande créée  →  promotionService.consume()   ← budget, en SQL conditionnel
```

**L'ordre n'est pas arbitraire.** Les promotions passent en premier parce
qu'une promotion exclusive peut interdire d'appliquer un code — et l'acheteur
doit l'apprendre avant de croire que son code a été ignoré par erreur.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `rules.ts` | évaluation des conditions — **ni base ni réseau** |
| `stacking.ts` | priorité, cumul, bornage — **ni base ni réseau** |
| `promotion.service.ts` | lecture, calcul, budget |
| `price-history.ts` | intégrité des prix |
| `referral.service.ts` | parrainage |
| `segmentation.service.ts` | segments |
| `growth.routes.ts` | API publique, vendeur, administration |

`rules.ts` et `stacking.ts` sont séparés du reste exprès : leurs propriétés —
une règle inconnue qui ne passe pas, une remise qui ne dépasse jamais sa base,
une promotion jamais perdue en route — se vérifient sans PostgreSQL, donc elles
le sont.

## Les drapeaux

| Variable | Défaut | Pourquoi |
|---|---|---|
| `TOUMA_GROWTH_PROMOTIONS_ENABLED` | `true` | |
| `TOUMA_GROWTH_COUPONS_ENABLED` | `true` | |
| `TOUMA_GROWTH_CAMPAIGNS_ENABLED` | `true` | |
| `TOUMA_GROWTH_SELLER_MARKETING_ENABLED` | `true` | |
| `TOUMA_GROWTH_FLASH_SALES_ENABLED` | **`false`** | mode d'échec : survente |
| `TOUMA_GROWTH_REFERRALS_ENABLED` | **`false`** | mode d'échec : fraude |
| `TOUMA_GROWTH_AUTOMATION_ENABLED` | **`false`** | mode d'échec : courriels en rafale |
| `TOUMA_GROWTH_AB_TESTING_ENABLED` | **`false`** | mode d'échec : conclusions fausses |

Les quatre fermés ne le sont pas par prudence de façade : chacun a un mode
d'échec qui se paie cher. Ils s'ouvrent quand quelqu'un a décidé de les
exploiter, pas parce qu'ils ont été écrits.
