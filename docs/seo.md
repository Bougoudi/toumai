# 🛍️ Boutique en ligne & référencement Google (SEO)

Toumai inclut une **boutique publique** optimisée pour Google :

| URL | Contenu |
| --- | --- |
| `/boutique` | Accueil : produits, catégories, FAQ |
| `/boutique/categorie/<nom>` | Une page par catégorie |
| `/boutique/produit/<nom-du-produit>-<id>` | Fiche produit + formulaire de commande |
| `/boutique/infos` | Livraison, retours, contact |
| `/sitemap.xml` | Plan du site pour Google (produits + images) |
| `/robots.txt` | Règles d'exploration (l'appli d'admin est exclue) |

Les commandes passées sur la boutique arrivent dans l'onglet **Commandes**
(canal `boutique`) et suivent le circuit habituel : paiement carte (iyzico ou
Stripe) → `PAID` → achat fournisseur + expédition.

## Ce qui est déjà fait dans le code

- **Pages rendues côté serveur** : Google lit tout le contenu sans exécuter de JavaScript.
- **Balises SEO** sur chaque page : `<title>` unique, meta description, URL canonique,
  Open Graph / Twitter (aperçus sur les réseaux sociaux), `lang="fr"`.
- **Données structurées schema.org** pour les **extraits enrichis** :
  `Product` + `Offer` (prix, stock, livraison, politique de retour), `BreadcrumbList`,
  `OnlineStore`/`LocalBusiness` (nom, adresse, téléphone), `FAQPage`, `WebSite`, `ItemList`.
  Aucun faux avis ni fausse note n'est déclaré (Google pénalise ça).
- **Rapidité (PageSpeed / Core Web Vitals)** : aucun script ni police externe, CSS en ligne,
  image principale prioritaire (`fetchpriority="high"`), autres images en `loading="lazy"`,
  dimensions d'image fixées (pas de décalage de mise en page), cache HTTP.
- **Une seule URL par produit** : si le nom change, l'ancienne URL redirige en 301.
- **Pages 404 propres** et pages transitoires (paiement, merci) en `noindex`.
- **Application d'administration exclue de Google** (`noindex` + `robots.txt`).

## À configurer dans l'appli (Paramètres → « Boutique en ligne & SEO »)

Renseigne nom, slogan, description, e-mail, téléphone, **adresse identique à ta fiche
Google Business**, délais de livraison et de retour. Ces valeurs alimentent les pages
et les données structurées.

> ⚠️ `PUBLIC_URL` doit être ton **vrai domaine en HTTPS** (ex. `https://www.maboutique.com`) :
> il sert aux URL canoniques et au sitemap.

## Page de vente « mono-produit »

Comme les boutiques à un seul produit vedette : Paramètres → « Page de vente ».

- **Prix barré** (seulement un ancien prix réel — un faux prix barré est interdit par
  la loi sur les pratiques commerciales trompeuses).
- **Points forts** : une ligne « Titre | explication » par point → liste à cocher sous le
  prix + sections « N raisons de choisir… » illustrées avec les photos du produit.
- **Comment ça marche** : une étape par ligne.
- **Mettre en avant** : l'accueil `/boutique` devient la page de vente de ce produit.
- **Offres par lot** (Boutique en ligne & SEO) : remise en % pour 2 et 3 articles,
  calculée côté serveur à la commande.
- **Bandeau d'annonce** en haut de page et **bouton « Commander » fixe** sur mobile.

Volontairement absents : faux avis, faux compteurs de clients, faux « stock limité » ou
comptes à rebours — Google et la loi sanctionnent ces pratiques. Ajoute uniquement de
vrais avis clients (par ex. via ta fiche Google Business Profile).

## Produit vedette : sweat de portage teddy (CJ `CJWY281211301AZ`)

Ajouté automatiquement au premier démarrage (une seule fois, `src/bootstrap/starterCatalog.ts`)
et mis en avant sur l'accueil si aucun autre produit ne l'est : fiche rédigée en français,
points forts, étapes, consignes de sécurité de portage, tailles S à XXL, couleurs beige / rose / gris, 34,90 €.

- **Photos** : 5 images retouchées (beige, rose, gris avec zoom tissu à la place des flammes CJ, photo réelle détourée sur fond blanc, guide des tailles en français). Pour ajouter d autres photos CJ :
  Paramètres → « Importer un produit CJdropshipping » → colle le SKU `CJWY281211301AZ`.
  Les photos et le prix d'achat sont ajoutés **sans écraser** tes textes ni ton prix.
- **À vérifier** : tailles réellement disponibles chez CJ et guide des tailles, frais de
  livraison CJ vers ton pays (le prix d'achat de 8,90 € est une estimation de 9,62 $ hors port).
- **Marché** : concurrents entre ~23 € et 30 € en entrée de gamme, 60 à 140 € pour les
  marques (Love Radius, Najell). Mots-clés : « sweat de portage », « veste de portage »,
  « sweat kangourou bébé », « pull de portage ». Saison forte : octobre à février.

## Pop-up « −10 % » et liste e-mail

- Pop-up d'inscription affichée une fois par visiteur (après 8 s ou 40 % de défilement),
  formulaire aussi dans le pied de page. Chaque inscrit reçoit un **code personnel à usage
  unique** (`BIENVENUE-XXXXXX`), pré-rempli automatiquement dans « Code promo » à la commande.
- Remise réglable (Paramètres → `newsletterPct`, 10 % par défaut) ; pop-up désactivable.
- Si `RESEND_API_KEY` est configurée, le code est aussi envoyé par e-mail avec un lien de
  désinscription (`/boutique/desinscription`).
- Liste des inscrits : Paramètres → « Inscrits newsletter ».

## Paiement par lien (sans société) — `PAYMENT_URL`

Si tu n'as pas encore de compte marchand avec API (iyzico API ou Stripe), la boutique
peut encaisser via un **lien de paiement hébergé**, par exemple **iyzico Link** :

1. Crée le lien dans ton espace iyzico, puis ajoute dans Render `PAYMENT_URL=https://…`.
2. À la commande, le client voit un **récapitulatif** (produit, taille, couleur, adresse,
   total), confirme, puis reçoit sa référence `TM-…` et le montant exact à régler.
3. La commande est enregistrée **« en attente »** : rien ne confirme automatiquement le
   paiement. Vérifie chaque paiement reçu (référence + montant) dans iyzico, puis passe la
   commande en « payée » dans l'onglet **Commandes**.

Dès que `IYZICO_API_KEY` ou `STRIPE_SECRET_KEY` est configuré, la boutique repasse
automatiquement au paiement intégré avec confirmation automatique.

Le montant est toujours recalculé côté serveur (prix catalogue, lot, code promo) ;
aucune clé secrète n'est envoyée au navigateur.

## Statistiques de visite

Tableau de bord de l'admin → **Visiteurs de la boutique** : visiteurs en ce moment
(5 dernières minutes), visiteurs et pages vues du jour, historique 14 jours, pages les
plus visitées. Aucun cookie ni adresse IP stockée (empreinte hachée avec un sel qui
change chaque jour), robots et navigateurs « Do Not Track » exclus, données supprimées
après 14 jours.

## Importer un produit CJdropshipping

1. Sur cjdropshipping.com : **My CJ → Authorization → API** → copie ta clé API.
2. Dans Toumai : Paramètres → « Importer un produit CJdropshipping » → colle la clé → Enregistrer.
3. Colle le lien du produit (ex. `https://www.cjdropshipping.com/product/-p-2603301127201619200.html`),
   indique le taux de change si ta boutique n'est pas en USD (les prix CJ sont en USD),
   et éventuellement ton prix de vente → **Importer et publier**.

Le produit (titre, photos, description, catégorie, prix d'achat) est créé en `ACTIVE`
et apparaît immédiatement sur `/boutique` et dans le sitemap. Réimporter le même lien
met la fiche à jour (pas de doublon, SKU `CJ-<id>`).

> Les pages produit de cjdropshipping.com sont protégées par un captcha : l'import passe
> donc par l'**API officielle CJ**, pas par la lecture de la page.

💡 **Réécris le titre et la description** (onglet Produits) avec tes propres mots et tes
mots-clés : un texte copié du fournisseur est identique chez des milliers de vendeurs,
Google ne le mettra pas en avant.

---

## Les outils Google & SEO, étape par étape

Ces outils demandent **ton compte** (Google, etc.) : personne ne peut s'y connecter à
ta place. Voici quoi faire dans chacun, dans l'ordre conseillé.

### 1. Google Search Console — ce qui marche déjà
1. https://search.google.com/search-console → **Ajouter une propriété** → « Préfixe de l'URL » → ton domaine.
2. Méthode **Balise HTML** : copie la valeur `content="…"` → colle-la dans Paramètres →
   « Code Google Search Console » → Enregistrer → clique **Valider**.
3. Menu **Sitemaps** → ajoute `sitemap.xml` → Envoyer.
4. **Inspection de l'URL** → colle l'URL d'un produit → **Demander une indexation**.
5. Chaque semaine : **Performances** → requêtes avec beaucoup d'impressions mais position 5–20
   = mots-clés à renforcer dans tes titres/descriptions.

### 2. Google Keyword Planner — volumes de recherche
https://ads.google.com → Outils → **Planificateur de mots clés** (compte Google Ads gratuit,
pas besoin de payer de pub). « Découvrir de nouveaux mots clés » → tape le produit → filtre
sur ton pays/langue. Vise des expressions de 3–5 mots, volume moyen, concurrence faible
(ex. « lampe coucher de soleil chambre » plutôt que « lampe »). Mets-les dans le **nom du
produit** (= titre Google) et le début de la description.

### 3. Google Trends — ce qui va exploser
https://trends.google.fr → compare 2–5 produits sur 12 mois, ton pays. Regarde
**« Requêtes associées → En hausse »** et la saisonnalité : importe le produit **4–6 semaines
avant le pic** pour laisser à Google le temps d'indexer.

### 4. AnswerThePublic — ce que les gens demandent vraiment
https://answerthepublic.com → tape le produit. Les questions (« comment », « pourquoi »,
« quel ») sont à reprendre **mot pour mot** dans la description produit.

### 5. Ubersuggest — idées et concurrents
https://neilpatel.com/ubersuggest → « Idées de mots clés » + « Aperçu du trafic » d'un site
concurrent → repère ses pages qui rankent et fais une fiche plus complète (photos, FAQ, délais).

### 6. Screaming Frog — réparer ce qui est cassé
Logiciel gratuit (500 URL) : https://www.screamingfrog.co.uk/seo-spider/ → entre
`https://ton-domaine/boutique` → Start. Vérifie les onglets :
**Response Codes** (aucune 404/5xx), **Page Titles** et **Meta Description** (pas de doublons —
deux produits au même nom = même titre, renomme-les), **Images** (texte alternatif = nom du produit, déjà géré).

### 7. PageSpeed Insights — vitesse
https://pagespeed.web.dev → colle une URL de produit. Les pages sont conçues pour un score
élevé ; le point qui dépend de toi : **le poids des photos fournisseur**. Si LCP > 2,5 s,
remplace les images trop lourdes. Héberge l'appli sur une offre toujours active (Render
« starter », pas « free » qui s'endort).

### 8. Test des résultats enrichis
https://search.google.com/test/rich-results → colle une URL de produit. Attendu :
**Extraits de produits**, **Fiches de marchand**, **Fil d'Ariane**, **FAQ** détectés, sans erreur.
(Google n'affiche plus les FAQ que pour certains sites d'autorité : c'est normal si elles
n'apparaissent pas dans les résultats.)

### 9. Yoast — nettoyer les erreurs
Yoast est une extension **WordPress** : elle ne s'installe pas sur Toumai. Ce qu'elle fait
(titres, meta descriptions, canonique, sitemap, schema, fil d'Ariane, noindex des pages
inutiles) est **déjà intégré** ici. Sa règle utile à garder : titre ≤ 60 caractères avec le
mot-clé au début, description 120–155 caractères.

### 10. Google Business Profile — être bien classé dans ta zone
1. https://business.google.com → crée la fiche : **même nom, adresse et téléphone** que dans
   Paramètres (cohérence « NAP », crucial pour le classement local).
2. Catégorie : « Boutique en ligne » / ton rayon ; ajoute le site `https://ton-domaine/boutique`.
3. Vérifie la fiche (courrier / vidéo), ajoute photos et produits.
4. Colle le lien de la fiche dans Paramètres → « Lien de ta fiche Google Business Profile »
   (relie la boutique à la fiche dans les données structurées).
5. Demande des **avis réels** à tes clients après livraison et réponds à chacun.

> Si tu vends uniquement en ligne sans accueillir de clients, Google exige de **masquer
> l'adresse** (zone desservie) — laisse alors l'adresse vide dans Paramètres.

---

### Être « premier sur Google » : la réalité
Aucun outil ne garantit la 1ʳᵉ place. Le code met toutes les bases techniques en place ;
le classement dépend ensuite de **contenu unique**, du **temps** (souvent 3–6 mois pour une
nouvelle boutique), de **liens** vers ton site (réseaux sociaux, blogs, partenaires) et des
**avis clients**. Commence par des mots-clés de niche peu concurrentiels (étapes 2–5), où
une nouvelle boutique peut réellement arriver en tête.
