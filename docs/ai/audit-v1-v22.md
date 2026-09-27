# V23 — audit de l'existant (V1 → V22)

Fait avant d'écrire une ligne de V23. Le but n'est pas de dresser un inventaire
flatteur : c'est de savoir ce qui existe déjà, pour ne pas le réécrire, et ce qui
est cassé, pour ne pas construire dessus.

## 1. Ce que le dépôt est réellement

Le cahier des charges V23 suppose NestJS, Next.js, Redis/BullMQ et OpenSearch.
Le dépôt est un **monolithe modulaire Express + Prisma + PostgreSQL 16**, domaine
sous `src/touma/`, monté sur `/api/v1` ; l'interface est en modules ES natifs
sous `public/touma/`. Ni Redis ni BullMQ ni OpenSearch ne sont installés —
`package.json` n'en contient aucun. V23 est donc bâti sur la pile réelle :
PostgreSQL pour le stockage et le cron existant (`src/touma/maintenance.ts`)
pour les travaux périodiques. Les abstractions demandées (fournisseur
d'embeddings, index de recherche) sont écrites pour qu'un OpenSearch ou un
pgvector se branche plus tard sans toucher aux appelants.

## 2. Le module IA existant

344 lignes, quatre fichiers, **zéro test**.

| Fichier | Rôle |
|---|---|
| `ai.types.ts` | contrat `AiProvider` — 3 méthodes |
| `ai.service.ts` | traçage + un seul fournisseur |
| `ai.routes.ts` | `/ai/provider`, `/generate`, `/classify`, `/recommend` |
| `providers/heuristic.provider.ts` | fournisseur local déterministe |

Modèles Prisma existants : `ToumaAiRequest`, `ToumaAiRecommendation`. Ils sont
**conservés et étendus** (§58 : ne pas dupliquer).

### Défauts trouvés

1. **Recommandations orphelines.** `ai.service.ts` persiste chaque
   recommandation sans renseigner `requestId`, alors que la relation existe
   dans le schéma. Aucune recommandation produite à ce jour n'est rattachable à
   l'appel qui l'a produite — ce qui vide de sens l'exigence d'auditabilité
   (§43).
2. **Écriture non authentifiée et non bornée.** `POST /ai/recommend` est en
   `optionalAuth`. Un visiteur anonyme déclenche une ligne `ToumaAiRequest` plus
   jusqu'à 24 lignes `ToumaAiRecommendation` par appel. Seul le limiteur global
   (300 req/min/IP) borne cela : 7 200 lignes par minute et par adresse.
3. **Invite stockée telle quelle.** `input` et `output` sont écrits bruts dans
   la base. Aucune minimisation, aucune rédaction (§9, §43).
4. **Le fournisseur s'appelle `mock`.** Il ne simule rien : il calcule pour de
   vrai, sur le catalogue réel. Le nommer `mock` laisse croire que ses résultats
   sont fictifs alors qu'ils sont exacts. V23 lui donne son vrai nom :
   `RULE_BASED` (§3).
5. **Contrat trop étroit.** Trois méthodes là où §3 en demande cinq ; aucune
   notion de capacité, donc rien ne distingue un fournisseur qui sait produire
   un embedding d'un qui ne sait pas.

Rien de tout cela n'est un accident de conception : le module a été écrit comme
une amorce. V23 le remplace par une couche complète sans jeter ce qui marche —
l'heuristique de recommandation devient le repli `RULE_BASED` obligatoire (§47).

## 3. Ce sur quoi les outils IA vont s'appuyer

L'audit des 30 modules donne le résultat le plus utile de cette phase : **les
services métier portent déjà le contrôle d'accès**. Leurs signatures sont de la
forme `service.methode(user, …)` et lèvent `forbidden()` / `notFound()`
elles-mêmes.

| Domaine | Service | Contrôle d'accès déjà porté |
|---|---|---|
| Catalogue | `productService.list/get` | statut `ACTIVE`, boutique active |
| Commandes | `orderService.list/get/tracking` | acheteur ou vendeur propriétaire |
| Panier | `cartService.get` | `userId` |
| Confiance | `trustService.get` + `redactForPublic` | composantes internes masquées |
| Logistique | `logisticsService.quote` | devis, pas d'exécution |
| B2B | `b2bService.listRfqs/getRfq/createRfq` | visibilité RFQ, propriété |
| Croissance | `flashSaleService`, `promotionService` | propriété boutique |
| Vendeur | `analyticsService.storeStats` | via `sellerRouter` |
| Admin | `intelligenceService.*` | via `requireAdmin` |
| Géographie | `geoService.provinces/localities` | données publiques réelles |

**Conséquence directe sur l'architecture V23** : un outil IA n'exécute jamais sa
propre requête Prisma. Il appelle le service, avec l'objet `ToumaRequestUser` de
celui qui parle. Le contrôle d'accès n'est donc pas réimplémenté dans la couche
IA — il est *hérité*. C'est la seule façon d'être sûr que §65 et §67 tiennent :
une escalade de privilège par outil supposerait que le service lui-même soit
percé, auquel cas l'API l'est déjà sans IA.

## 4. Logique dupliquée trouvée

- **`reputation` (V11) et `trust` (V21) coexistent.** Deux scores de vendeur,
  deux pondérations, deux routes publiques. `reputation.service.ts` calcule sur
  la boutique, `trust.service.ts` sur quatre types d'entités. Ce n'est pas
  corrigé ici : fusionner deux scores publics change ce que les vendeurs voient
  affiché et mérite sa propre décision. Consigné. Pour V23, **`trust` est la
  seule source** utilisée par les outils IA, parce que c'est elle qui sait se
  rédiger pour le public.
- **Recherche produit en trois endroits** : `buildProductFilters`
  (catalogue, avec facettes), `/search` transverse dans `touma.routes.ts`, et la
  requête interne de `heuristic.provider.ts`. La recherche IA de V23 passe par
  `buildProductFilters` — la troisième disparaît.

## 5. Ce qui manque et que V23 doit apporter

Aucun de ces éléments n'existe dans le dépôt : passerelle, registre de
fournisseurs, routage de modèle, comptabilité de coût, plafonds, système
d'outils, niveaux de risque, défense contre l'injection d'invite, minimisation
des données, conversations, mémoire, confirmation d'action, versionnage
d'invite, retour utilisateur, évaluation, tableau de bord de coût.

## 6. Verdict

L'existant n'est pas à réécrire. Il est à **brancher** : trente modules qui
savent déjà dire non à qui ne doit pas lire, et une amorce d'IA qui ne sait pas
encore leur parler. V23 écrit le chaînon, et rien d'autre.
