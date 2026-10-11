# Plan de mesure, UTM et tableau de bord

## Ce qui existe déjà (vérifié dans le code)
- **Analytics interne sans cookies** (Admin → Analytics) :
  - visites, pays, pages ;
  - entonnoir `view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, puis `purchase` (enregistré **côté serveur**, seulement après vérification du paiement) ;
  - respect de GPC et Do Not Track.
- **Attribution UTM** : la session et la commande gardent `utm_source`, `utm_medium`, `utm_campaign` et `utm_content`. Admin → Marketing → Campaigns génère les liens et calcule coût par client et ROAS à partir des **vraies** commandes.
- **Nouveau, facultatif** : GA4, Meta Pixel, TikTok Pixel et Pinterest Tag, activés seulement si vous fournissez un identifiant public dans Render.

## Événements
| Événement | Déclencheur | Interne | GA4 | Meta | TikTok | Pinterest |
|---|---|---|---|---|---|---|
| Vue produit | page produit chargée | view_item | view_item | ViewContent | ViewContent | pagevisit |
| Ajout au panier | clic + ajout réel au panier | add_to_cart | add_to_cart | AddToCart | AddToCart | addtocart |
| Début de commande | page de paiement chargée avec un panier | begin_checkout | begin_checkout | InitiateCheckout | InitiateCheckout | — |
| Inscription e-mail | **réponse 201 du serveur** | (compte dans Admin) | sign_up | Lead | CompleteRegistration | signup |
| Achat | **page de commande, paiement vérifié par le serveur, 1 fois par commande** | purchase (serveur) | purchase | Purchase (eventID = n° de commande) | CompletePayment | checkout |

Aucun nom, e-mail, téléphone ou adresse n'est envoyé aux plateformes.

## Convention UTM (minuscules, tirets)
| Paramètre | Valeurs |
|---|---|
| utm_source | tiktok · instagram · facebook · youtube · pinterest · google · newsletter · {créateur} |
| utm_medium | social (organique) · paid_social · creator · email · cpc |
| utm_campaign | `bio`, `organic-oct`, `gift-season`, `creator-{nom}`, `meta-test-1` |
| utm_content | identifiant de la vidéo ou de l'annonce (`v01-cold-office`, `v02-texture`) |

Exemple : `https://<domaine>/product?color=pearl-white&utm_source=tiktok&utm_medium=social&utm_campaign=organic-oct&utm_content=v02-texture`

## Activer un pixel (quand vous serez prêt)
1. Créez l'outil chez la plateforme (Events Manager pour Meta, Events pour TikTok, Conversions pour Pinterest, flux Web pour GA4) et copiez l'**ID public** :
   - GA4 : `G-XXXXXXX` ;
   - Meta : 15–16 chiffres ;
   - TikTok : lettres majuscules et chiffres ;
   - Pinterest : chiffres.
2. Render → Environment : `GA4_MEASUREMENT_ID`, `META_PIXEL_ID`, `TIKTOK_PIXEL_ID` ou `PINTEREST_TAG_ID`. **Jamais de jeton secret** (API Conversions) dans ces variables.
3. Redéployez, puis vérifiez avec l'extension officielle (Meta Pixel Helper, TikTok Pixel Helper, Tag Assistant) que `PageView` et `ViewContent` arrivent.
4. Vérifiez qu'avec GPC activé (Brave, extension « OptMeowt ») **rien** ne se charge.

## Tableau de bord (hebdomadaire, 20 min)
| Indicateur | Source | Seuil de décision [H] |
|---|---|---|
| Visites par source (UTM) | Admin → Analytics / Campaigns | — |
| Taux vue produit → ajout au panier | Admin → Analytics (entonnoir) | si < 3 % sur 200 vues produit : retravailler la page ou le prix [H] |
| Ajout au panier → achat | idem | si des ajouts mais 0 achat : vérifier le paiement, la livraison, la confiance |
| Inscriptions WELCOME10 | Admin → Marketing → Email list | — |
| Ventes par code créateur | Admin → Marketing → Promo codes | — |
| Coût par achat (pub) | Campaigns (dépense saisie) | ≤ CAC max (≈ 15,94 $) : continuer ; > 2× : arrêter |
| Vidéos : taux de visionnage, partages, enregistrements | apps des plateformes | garder les 2 meilleures accroches par semaine |

Les seuils [H] sont des règles de décision proposées, pas des moyennes du marché.
