# TOUMA Trust — architecture

## Quatre concepts, et ne pas les confondre

| | Ce que ça mesure | D'où ça vient | Public ? |
|---|---|---|---|
| **Vérification** | des **pièces** contrôlées | un examinateur, demain un prestataire KYC/KYB | oui (le statut, pas les pièces) |
| **Performance** | ce que les transactions **démontrent** | commandes, expéditions, litiges, messages | oui |
| **Réputation** | ce que les acheteurs **déclarent** | avis liés à un achat réel | oui |
| **Risque** | des **signaux** de fraude | comportement, incohérences | **non** |

Les confondre serait la première erreur, et elle se paie de deux façons.
Publier un signal de risque, c'est publier une suspicion non établie — une
accusation, sur une page que n'importe qui peut lire. Traiter une vérification
comme une performance, c'est croire qu'un dossier bien monté remplace une
livraison tenue.

## Ce qui existait déjà, et qui n'a pas été refait

V21 n'a pas créé un moteur de réputation : il en existait un.

- `ToumaStoreReputation` + `reputation.service.ts` (V17) mesurent la
  **performance** d'une boutique sur des transactions réelles — ponctualité,
  annulations, litiges, retours, réactivité — avec des pondérations publiées et
  un seuil de volume en dessous duquel rien n'est affiché.
- `ToumaRiskScore` et `ToumaFraudEvent` portent le **risque** d'un compte, en
  signaux pondérés qui ne bloquent jamais seuls.
- `ToumaSellerVerification` porte la **vérification**, avec ses pièces privées
  et sa décision auditée.
- `ToumaReview` impose déjà l'achat vérifié : un avis sans commande livrée est
  impossible, et il ne peut y en avoir qu'un par couple commande/produit.

Le moteur de confiance **agrège** ces mesures. Il ne les recalcule pas. Les
recalculer aurait produit deux chiffres divergents pour la même chose, et la
question « lequel est le bon ? » n'a pas de bonne réponse.

## Le chemin d'un fait jusqu'à un score

```
   commande livrée          ToumaTrustEvent           balayage (5 min)
   litige ouvert     ───▶   (fait consigné)    ───▶   processTrustEvents()
   avis déposé                                              │
   retour accepté                                           ▼
                                                    trustService.compute()
                                                            │
                        ┌───────────────────────────────────┤
                        ▼                                   ▼
                 ToumaTrustScore                   ToumaTrustScoreSnapshot
                 (état courant)                    (historique daté, jamais écrasé)
                        │
                        ▼
                  awardBadges()
```

**Pourquoi des événements plutôt qu'un recalcul en ligne.** Une commande
terminée change la confiance de la boutique, de l'acheteur et de chaque produit.
Les recalculer pendant la requête allongerait le chemin critique d'un paiement
pour un chiffre qui n'a pas besoin d'être à la microseconde.

**Pourquoi c'est acceptable ici et pas pour de l'argent.** Il n'y a ni reprise
après échec ni garantie d'exécution. Un événement perdu ne corrompt rien, parce
que chaque score se recalcule **depuis des faits en base** et jamais depuis un
cumul d'incréments : le prochain calcul repart des mêmes commandes et retrouve
le même résultat. Un registre financier, lui, n'a pas cette propriété — c'est
pourquoi le même raccourci y serait inacceptable.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `weights.ts` | pondérations, seuils, décroissance. **Toute** la paramétrie |
| `scoring.ts` | l'arithmétique seule — ne touche ni base ni réseau |
| `trust.service.ts` | mesure, assemble, consigne, historise |
| `badges.ts` | règles de badges et leur attribution |
| `events.ts` | consignation des faits et recalcul différé |
| `verification-levels.ts` | ce qu'exige chaque niveau |
| `verification-provider.ts` | frontière KYC/KYB — **ne vérifie rien** |
| `review-risk.ts` | manipulation des avis |
| `transaction-risk.ts` | risque d'une commande |
| `standing.service.ts` | sanctions et recours |
| `trust.routes.ts` | API publique, intéressé, administration |

`scoring.ts` est séparé du reste exprès : ses propriétés — score borné,
composante non mesurée qui ne pénalise pas, pénalité qui pénalise vraiment — se
vérifient sans base de données, donc elles sont vérifiées.

## Les drapeaux

| Variable | Défaut | Effet |
|---|---|---|
| `TOUMA_TRUST_ENABLED` | `true` | coupe tout le module (503 sur `/trust/*`) |
| `TOUMA_TRUST_VERIFICATION_ENABLED` | `true` | dépôt de dossiers |
| `TOUMA_TRUST_REVIEW_MODERATION_ENABLED` | `true` | file de modération |
| `TOUMA_TRUST_SUPPLIER_SCORE_ENABLED` | `true` | score fournisseur B2B |
| `TOUMA_TRUST_TRANSACTION_RISK_ENABLED` | `true` | évaluation au passage de commande |
| `TOUMA_TRUST_AI_ENABLED` | `false` | explication d'un score par l'IA |

`TOUMA_TRUST_AI_ENABLED` est **fermé par défaut**, et ce n'est pas de la
prudence de façade : le score est déjà explicable sans IA — la ventilation
suffit. L'IA ne ferait que mettre en phrases, et il vaut mieux qu'elle soit
absente qu'approximative sur un sujet qui décide d'une réputation.
