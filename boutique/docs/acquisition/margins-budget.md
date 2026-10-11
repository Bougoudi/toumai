# Marges et budget (chiffres du 11/10/2026)

## Données d'entrée
| Donnée | Valeur | Statut |
|---|---|---|
| Prix de vente | 49,99 $ (`STORE_PRICE_USD` sur Render, vérifié via `/api/config`) | [V] |
| Livraison facturée au client | 0 $ (incluse) | [V] |
| Coût produit | 17 $ (votre chiffre ; défaut du code mis à jour) | [E] à reconfirmer à chaque commande fournisseur |
| Expédition fournisseur → client US | 15 $ | [E] à reconfirmer |
| Frais de paiement iyzico (cartes internationales, USD) | **inconnus** — iyzico pas encore configuré | Donnée manquante |
| Taxes de vente US | non collectées aujourd'hui ; à étudier selon les seuils par État | Donnée manquante |
| Taux de retours / remboursements | inconnu (aucune vente) | Donnée manquante |
| Coûts fixes | Render Starter ≈ 7 $/mois (si vous passez au payant) ; domaine (prix selon registrar) | [E] |

## Marge par commande (1 plaid)
| Scénario | Encaissé | − Coûts (17 + 15) | − Frais paiement | **Marge avant pub** | % |
|---|---|---|---|---|---|
| A. Sans code, frais inconnus | 49,99 | 32,00 | 0 (inconnus) | **17,99 $** | 36,0 % |
| B. Sans code, frais [H] 3,5 % + 0,30 $ | 49,99 | 32,00 | 2,05 | **15,94 $** | 31,9 % |
| C. WELCOME10, frais inconnus | 44,99 | 32,00 | 0 | **12,99 $** | 28,9 % |
| D. WELCOME10, frais [H] 3,5 % + 0,30 $ | 44,99 | 32,00 | 1,87 | **11,12 $** | 24,7 % |

> [H] 3,5 % + 0,30 $ est une **hypothèse de sensibilité**, pas le tarif iyzico. Remplacez-la par votre contrat dans Admin → Settings (le calculateur de marge Marketing applique alors les vrais frais).

**Ne pas confondre** :
- le **chiffre d'affaires** (49,99 $) ;
- la **marge avant publicité** (17,99 $) ;
- le **bénéfice net** (marge − pub − coûts fixes − retours) ;
- le **ROAS** (chiffre d'affaires ÷ dépense pub).

## Coût d'acquisition et ROAS d'équilibre
| Scénario | CAC maximal théorique (= marge) | ROAS d'équilibre (= CA ÷ marge) |
|---|---|---|
| A | 17,99 $ | **2,78** |
| B | 15,94 $ | 3,14 |
| C | 12,99 $ | 3,46 |
| D | 11,12 $ | 4,05 |

Un remboursement d'un article non renvoyé (dropshipping) coûte ≈ 32 $ + frais : **un seul remboursement efface la marge de ~2 ventes**. Le risque qualité produit (rapports de test, photos fidèles) est donc aussi un risque financier.

**Coût maximal par clic, selon le taux de conversion** (inconnu tant qu'il n'y a pas de ventes) :
- formule : coût par clic max = CAC max × taux de conversion ;
- avec un CAC max de 15,94 $ (scénario B) : 1 % de conversion → 0,16 $ ; 2 % → 0,32 $ ; 3 % → 0,48 $.
- Ces taux sont des **hypothèses de calcul**, pas des moyennes du secteur.

## Scénarios de ventes mensuelles (scénario B, avant pub et coûts fixes)
| Ventes / mois | Chiffre d'affaires | Marge avant pub |
|---|---|---|
| 10 | 499,90 $ | 159,40 $ |
| 30 | 1 499,70 $ | 478,20 $ |
| 100 | 4 999,00 $ | 1 594,00 $ |

## Budgets recommandés
| Budget | Conditions préalables | Utilisation | Critères de décision |
|---|---|---|---|
| **0 $** (maintenant) | aucune | Échantillon (coût produit), comptes sociaux, vidéos organiques, Pinterest, liste e-mail, Search Console | Signaux : vues, enregistrements/partages, clics en bio, inscriptions WELCOME10 |
| **25 $** (après paiement réel + vraies vidéos) | paiement iyzico **live**, domaine propre, pixel Meta (`META_PIXEL_ID`), 3 vidéos réelles | Meta : 5 jours × 5 $/jour, objectif trafic/vues de page de destination, 2–3 créations | Garder la création avec le meilleur coût par vue de page ; **arrêter** une création si son coût par vue dépasse ~0,50 $ après 5 $ dépensés [H, dérivé du calcul ci-dessus] ; ne pas juger le ROAS sur 25 $ (trop peu de données) |
| **50–100 $** | idem + au moins 1 vente organique ou 10+ ajouts au panier | Meta 10 j × 5–10 $/jour sur la meilleure création ; TikTok seulement à 100 $ (ad group > 20 $/jour → 5 jours) | **Augmenter** si coût par achat ≤ CAC max (≈15,94 $) sur ≥ 3 achats ; **modifier** si ajouts au panier mais pas d'achat (vérifier paiement, prix, livraison) ; **arrêter** après 2× le CAC max sans achat |

Non recommandé pour l'instant : Pinterest Ads (minimum non publié, ≈ 100 $/jour cité [S]), Google Shopping payant (Merchant Center impossible sans paiement réel).

**Aucune dépense n'est engagée sans votre autorisation explicite.**
