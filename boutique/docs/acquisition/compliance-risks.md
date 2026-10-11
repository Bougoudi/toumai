# Conformité et risques (États-Unis)

Ce document n'est pas un avis juridique. Les sources sont dans `sources.md`. Statuts : À faire · En cours · Terminé · Bloqué.

## 1. Avis, témoignages, créateurs (FTC)
- **Endorsement Guides** : tout lien matériel (produit offert, commission, code) doit être divulgué clairement **dans** la vidéo et la légende (« #ad », « gifted », « Paid partnership »). La marque doit surveiller et faire corriger.
- **Règle sur les faux avis (16 CFR 465)** : interdits les avis inventés, achetés, générés par IA ou présentés comme venant de clients qui n'existent pas ; interdit de supprimer les avis négatifs de façon trompeuse.
- Dans le code : avis désactivés (`REVIEWS_ENABLED` éteint), modération et achat vérifié prévus. **Terminé** côté technique ; activation à décider après de vraies livraisons.

## 2. E-mail (CAN-SPAM)
- Adresse postale valide dans chaque e-mail commercial, objet non trompeur, lien de désinscription qui fonctionne, désinscription traitée sous 10 jours ouvrés.
- Dans le code : lien de désinscription en place. **Bloqué** pour l'envoi : adresse postale (`STORE_BUSINESS_ADDRESS`) et service d'envoi non configurés. Aucun e-mail marketing ne doit partir avant.

## 3. Vie privée et pixels (CCPA/CPRA et lois des États)
- Les seuils CCPA ne sont probablement pas atteints au départ [S], mais les pixels publicitaires peuvent être assimilés à du « partage » ; plusieurs États exigent de respecter **Global Privacy Control**.
- Dans le code : aucune balise sans identifiant configuré ; GPC, Do Not Track et refus bloquent tout chargement ; Meta en mode LDU ; aucune donnée personnelle envoyée. **Terminé**.
- À faire avant d'activer un pixel : mettre à jour la page Privacy (liste des outils, finalité, comment refuser).

## 4. Sécurité du produit (CPSC)
- Rappels 2026 de produits proches (plaids chauffants sherpa OCTROT, couvertures chauffantes JKMAX) : le risque d'incendie ou de brûlure est surveillé.
- Il n'existe pas de norme UL évidente pour un plaid 5 V USB (UL 964 vise les couvertures sur secteur). Ne revendiquer **aucune** certification sans document.
- Ne jamais présenter le produit comme sûr pour dormir, médical, pour enfants ou pour personnes ne pouvant pas réagir à la chaleur.
- Statut : **Bloqué** tant que le fournisseur n'a pas fourni ses documents (voir §6).

## 5. Promesses commerciales
- **Livraison (Mail Order Rule)** : n'annoncer qu'un délai avec une base raisonnable ; sinon prévenir le client et proposer l'annulation. Délai 2–8 jours **non confirmé**.
- **Prix** : pas de prix barré fictif, pas de compte à rebours, pas de « stock limité » inventé.
- **Batterie** : toujours « power bank not included ».
- **Images IA** : signalées sur le site et dans les métadonnées ; jamais utilisées comme preuve du produit. **Terminé**.

## 6. Documents à demander au fournisseur (avant toute publicité payante importante)
| Document | Pourquoi | Statut |
|---|---|---|
| Rapports de test électrique / sécurité (laboratoire, numéro de rapport) | sécurité, réponse aux plateformes | À faire |
| Spécification USB exacte (tension, intensité, puissance) | compatibilité batterie, page produit, article SEO | À faire |
| Déclaration FCC (si électronique de commande) | conformité US | À faire |
| Dimensions et poids réels | page produit | À faire |
| Composition du tissu | page produit, étiquetage textile (FTC Textile Rule) | À faire |
| Instructions d'entretien et de lavage (avec ou sans module) | ne rien affirmer sans elles | À faire |
| Pays d'origine, entrepôt d'expédition, délais vers 3 régions US | page livraison, Merchant Center | À faire |
| Contenu exact du colis, notice en anglais | transparence (« what's in the box ») | À faire |
| Usage autorisé en voiture ? | vidéo #13 exclue en attendant | À faire |

## 7. Comptes et plateformes
- Respecter les règles publicitaires de chaque plateforme (produits électriques, allégations). Ne jamais dire qu'un compte est approuvé avant de l'avoir constaté.
- Aucun identifiant secret dans le code : seulement les identifiants **publics** de pixels, dans Render.
