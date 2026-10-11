# Google : Search Console et Merchant Center (étapes vérifiées)

Le guide technique détaillé (en anglais) reste `../GOOGLE_MERCHANT_CENTER.md`. Cette page dit **ce qui est prêt, ce qui bloque, et dans quel ordre agir**.

## Ce qui est prêt dans le code (Terminé)
| Élément | URL / réglage |
|---|---|
| Sitemap | `/sitemap.xml` |
| Flux produit | `/feeds/google-merchant.xml` : un article par couleur, lien `/product?color=…`, **uniquement des vraies photos** (les 3 images IA sont exclues), description factuelle, `g:product_type` |
| Données structurées | `ProductGroup` + une `Offer` par couleur, `BreadcrumbList`, politique de retour (`ReturnFeesCustomerResponsibility`) ; images IA exclues |
| Balise de vérification | variable `GOOGLE_SITE_VERIFICATION` |

## Prérequis exigés par Google (vérifiés le 11/10/2026)
| Prérequis | État | Statut |
|---|---|---|
| Paiement réellement fonctionnel (pas de commande « démo ») | `checkoutEnabled:false` en production | **Bloqué** (compte iyzico) |
| Coordonnées visibles : e-mail, raison sociale, adresse | variables vides sur Render | À faire (vous) |
| Politique de retour et page livraison cohérentes avec le compte Merchant Center | pages présentes ; délais de livraison à confirmer | En cours (délais fournisseur) |
| Domaine propre (recommandé) | `havenlume.onrender.com` (Public Suffix List) | À faire (vous) |
| Images : pas d'image IA présentée comme photo du produit | images IA marquées (IPTC) et exclues du flux | Terminé |

## Ordre recommandé
1. **Search Console** (possible dès maintenant, gratuit) : propriété « préfixe d'URL » → méthode « balise HTML » → coller la valeur dans `GOOGLE_SITE_VERIFICATION` sur Render → redéployer → Vérifier → soumettre `sitemap.xml`. *Modifie la production : à faire par vous ou avec votre accord explicite.*
2. Renseigner `STORE_SUPPORT_EMAIL`, `STORE_BUSINESS_NAME`, `STORE_BUSINESS_ADDRESS`.
3. Obtenir le **délai de livraison réel** vers les États-Unis (au moins 3 régions) et mettre la page livraison à jour.
4. Activer le **paiement réel** iyzico.
5. **Merchant Center** : pays États-Unis, USD → vérifier et revendiquer le site → livraison (coût, délais réels) → retours (30 jours, frais de retour à la charge du client sauf défaut) → Produits → Sources → ajouter le flux planifié `https://<domaine>/feeds/google-merchant.xml` (quotidien).
6. Activer les **fiches gratuites** (free listings) avant toute campagne Shopping payante.
7. Lire l'onglet Diagnostics ; corriger avant de penser à la publicité.

## Points d'attention
- **« Ships from »** : si l'article part de l'étranger ou d'un entrepôt fournisseur, l'indiquer honnêtement sur la page livraison, avec un délai que vous pouvez tenir (règle FTC sur la vente à distance).
- Ne jamais déclarer dans Merchant Center un délai plus court que celui affiché sur le site.
- Ne pas ajouter d'images IA dans le flux, même pour Pearl White.
