# Sources (consultées le 11/10/2026)

Légende : **[V]** fait vérifié sur la page citée · **[S]** source secondaire (blog, outil tiers, extrait de recherche) · **[NV]** non vérifié.
Aucun chiffre de ventes, de conversion ou de coût publicitaire n'a été inventé : ce qui n'était pas disponible gratuitement est signalé.

## Google (Merchant Center, Search Central, Ads)
| Ce que ça prouve | Source | Statut | Application HavenLume |
|---|---|---|---|
| Le client doit pouvoir ajouter au panier **et finaliser l'achat** ; le paiement invité doit fonctionner | https://support.google.com/merchants/answer/6363310 · https://support.google.com/merchants/answer/9158778 | [V] | **Bloquant** : pas de fiches Google tant que le paiement est en mode démo |
| Coordonnées clairement affichées, au moins un moyen de paiement standard, SSL | https://support.google.com/merchants/answer/6363310 | [V] | Renseigner e-mail support, raison sociale, adresse |
| Politique de retour obligatoire, cohérente avec Merchant Center | https://support.google.com/merchants/answer/14011730 | [V] | Déjà publiée (/returns, 30 jours) |
| Paramètres de livraison obligatoires aux US | https://support.google.com/merchants/answer/13889434 | [V] | Livraison 0 $ dans le flux ; délais à confirmer |
| Fausse représentation : identité/adresse fausse, frais cachés, provenance cachée → suspension sans préavis | https://support.google.com/merchants/answer/6150127 | [V] | Indiquer que l'article est expédié par un partenaire (provenance) |
| Vérification/revendication du site (balise HTML, GA, GTM…) | https://support.google.com/merchants/answer/176793 | [V] | `GOOGLE_SITE_VERIFICATION` déjà prise en charge |
| Spécification produit : id, title (150), description (5000, pas de promo), link, image_link, availability, price, brand, identifier_exists | https://support.google.com/merchants/answer/7052112 | [V] | Flux conforme ; description factuelle ajoutée |
| Balisage « merchant listing » : Product + Offer (price, currency), recommandés : shipping, return policy | https://developers.google.com/search/docs/appearance/structured-data/merchant-listing | [V] | ProductGroup + 1 Offer par couleur ajoutés |
| Abus de contenu à grande échelle / pages satellites interdits | https://developers.google.com/search/docs/essentials/spam-policies | [V] | Pas de pages SEO en série ; 5 articles utiles max |
| Contenu IA autorisé s'il est utile ; **images IA e-commerce : métadonnées IPTC `TrainedAlgorithmicMedia`** | https://developers.google.com/search/docs/fundamentals/using-gen-ai-content | [V] | Fait : métadonnées ajoutées, images IA exclues du flux |
| Dépense quotidienne Google Ads jusqu'à 2× la moyenne, plafond mensuel 30,4× | https://support.google.com/google-ads/answer/6385083 | [V] | Fixer le budget en tenant compte de ce dépassement |
| Google Ads : pas de budget minimum | — | [NV] | À confirmer dans l'interface |

## Meta, TikTok, Pinterest, YouTube
| Ce que ça prouve | Source | Statut | Application |
|---|---|---|---|
| Meta : budget minimum indicatif ~1 USD/jour (impressions) | https://www.facebook.com/business/help/203183363050448 | [S] | Test à 25 $ possible (5 $/jour) |
| Meta : vérification de domaine (Business Settings → Brand safety → Domains) | https://www.facebook.com/business/help/321167023127050 | [V] | Nécessite un domaine que vous contrôlez |
| `onrender.com` est dans la Public Suffix List → `havenlume.onrender.com` = son propre domaine racine | https://publicsuffix.org/list/public_suffix_list.dat | [V] | **Domaine personnalisé recommandé** avant pixels/annonces |
| Meta Limited Data Use (`dataProcessingOptions LDU`) | https://developers.facebook.com/docs/marketing-apis/data-processing-options | [V] | Appliqué dans `public/js/tags.js` |
| TikTok Ads : budget **> 50 $/jour (campagne)** et **> 20 $/jour (groupe d'annonces)** | https://ads.tiktok.com/help/article/budget | [V] | TikTok Ads impossible avec 25 $ ; organique seulement |
| TikTok Creative Center : gratuit, public (Top Products : connexion, desktop) | https://ads.tiktok.com/resources/help/article/creative-center?lang=en | [V] | Outil d'inspiration gratuit |
| TikTok : lien en bio pour comptes généraux à partir de 1 000 abonnés ; comptes Business vérifiés sans seuil | (page support redirigée) | [S] | À vérifier dans l'app à la création du compte |
| TikTok Limited Data Use pour Pixel/Events API | https://business-api.tiktok.com/portal/docs/events-api-v1-limited-data-use/v1.3 | [V] | Respect GPC géré côté site |
| Pinterest : budget minimum non publié (≈100 $/jour cité par un représentant communautaire) | https://help.pinterest.com/en/business/article/set-up-campaign-budgets | [S] | Pinterest payant hors budget ; organique prioritaire |
| Pinterest Tag + `event_id` pour dédoublonner avec l'API | https://help.pinterest.com/en/business/article/install-the-pinterest-tag | [V] | `order_id/event_id` = numéro de commande |
| Pinterest Trends (sélecteur de pays, navigateur) | https://help.pinterest.com/en/business/article/pinterest-trends | [S] | Disponibilité US très probable |
| YouTube Shorts : liens non cliquables en description/commentaires | https://support.google.com/youtube/answer/13748639 | [V] | CTA « link in bio / search HavenLume » |
| Instagram/Facebook Reels : règles de liens | — | [NV] | Lien en bio / bouton profil |
| GA4 consent mode (basique vs avancé) | https://developers.google.com/tag-platform/security/concepts/consent-mode | [V] | Mode basique : GA4 chargé seulement si autorisé |

## Légal et sécurité (US)
| Ce que ça prouve | Source | Statut | Application |
|---|---|---|---|
| Divulgation obligatoire des produits offerts/payés/commissions, dans la publication (pas en bio) | https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers | [V] | Clause dans le message aux créateurs |
| La marque doit former et surveiller ses partenaires ; lien affilié = divulgation près du lien | https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides | [V] | Checklist créateurs |
| Règle FTC avis (16 CFR 465) : faux avis (y compris IA), incitations liées au sentiment, suppression d'avis interdits ; amendes civiles | https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials | [V] (date d'entrée en vigueur : [S] oct. 2024) | Aucun avis/témoignage IA ; avis désactivés jusqu'à vrais clients |
| CAN-SPAM : adresse postale, désinscription sous 10 jours ouvrés, objet non trompeur ; jusqu'à 53 088 $/e-mail | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business | [V] | Ajouter `STORE_BUSINESS_ADDRESS` avant tout envoi |
| CCPA : seuils (26,625 M$ de CA, 100 000 consommateurs CA…), « sharing » pour la publicité comportementale, GPC à respecter | https://cppa.ca.gov/faq.html · https://www.law.cornell.edu/regulations/california/11-CCR-7025 | [V] | Probablement sous les seuils ; GPC respecté quand même |
| Règle FTC vente à distance : base raisonnable pour tout délai annoncé, sinon 30 jours ; remboursement sous 7 jours ouvrés | https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule | [V] | Aucun délai promis tant que non confirmé (déjà le cas) |
| Rappel CPSC 26-652 : plaids chauffants « sherpa » OCTROT (≈178 000 unités, Amazon), risque d'incendie | https://www.cpsc.gov/Recalls/2026/Heated-Sherpa-Throws-and-Blankets-Recalled-Due-to-Risk-of-Serious-Injury-or-Death-from-Fire-and-Burn-Hazards-Sold-on-Amazon-by-OCTROT | [V] | Exiger les rapports de test du fournisseur |
| Rappel CPSC 26-778 : couvertures et coussins chauffants JKMAX (≈195 000 unités, 53 brûlures) | https://www.cpsc.gov/Recalls/2026/JKMAX-Recalls-Heated-Blankets-and-Heating-Pads-Due-to-Fire-and-Burn-Hazards | [S] | Idem ; ne jamais promettre « safe » |
| UL 964 vise la literie chauffante 110–120 V ; produits 5 V « soumis à investigation » | https://standards.globalspec.com/std/14548953/ul-964 | [S] | Aucune norme UL revendiquée ; demander l'avis d'un labo |
| FCC Part 15 : un contrôleur à microcontrôleur peut être un « radiateur non intentionnel » | https://www.law.cornell.edu/cfr/text/47/15.103 | [V] texte / [NV] application | Question à poser au fournisseur |

## Marché et concurrents
| Ce que ça prouve | Source | Statut |
|---|---|---|
| ActionHeat 7V : 119,99 $, batterie incluse, 30 j de retour, 1 an de garantie | https://www.actionheat.com/products/actionheat-7v-battery-heated-plush-throw-blanket | [V] |
| ActionHeat chez Target 119,99 $, 4,6★ (11 avis), retours 90 j | https://www.target.com/p/actionheat-7v-electric-throw-blanket/-/A-82380782 | [V] |
| Bedsure Wearable Heated Blanket, TikTok Shop 129,99 $, 4,6★ (5 306 avis) | https://shop.tiktok.com/us/pdp/1729642265408016630 | [V] |
| Sunbeam On-the-Go Cordless Throw 84,97 $ (Walmart) | https://www.walmart.com/ip/15216710679 | [S] (extrait, page bloquée) |
| Châles USB vendeurs tiers Walmart 27–45 $, certains avec batterie 10 000 mAh | https://www.walmart.com/ip/17866366778 | [S] |
| Annonces Amazon « Power Bank NOT Included » dans le titre | https://www.amazon.com/dp/B09P4T1BD6 | [S] |
| Volumes Amazon US hebdomadaires (hors saison) : « usb heated blanket » ≈312, « heated shawl » ≈379, « portable heated blanket » 370 ; « heating blanket » ≈31 805 (janv.) | https://www.asinsight.com/report/US/usb-heated-blanket · /heated-shawl · /portable-heated-blanket · /heating-blanket | [S] (outil tiers, Amazon) |
| Saisonnalité : hausse en octobre, pic nov.–déc., creux mai–août | https://www.sellersprite.com/en/blog/electric-blanket-report · https://www.accio.com/business/trending-heated-blanket-2026 | [S] |
| Objections : chaleur insuffisante, autonomie, compatibilité batterie (« < 2A, 5V »), connecteur chaud | Avis Target (lien ci-dessus), extraits Amazon/Walmart, https://www.motorhomefun.co.uk/forum/threads/usb-heated-blanket-or-throws.265476/ | [S] |
| Meta Ad Library des concurrents | — | [NV] (connexion requise) |
