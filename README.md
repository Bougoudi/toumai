# Toumai — Plateforme d'automatisation e-commerce (dropshipping)

Toumai automatise l'ensemble du cycle du dropshipping, autour de **4 piliers** :

| # | Pilier | Ce que ça fait | Point d'entrée API |
|---|--------|----------------|--------------------|
| 1 | **Analyse marché** | Détecte en continu des produits gagnants (demande, tendance, concurrence) | `POST /api/market/scan` |
| 2 | **Génération de produits** | Crée et publie des centaines de produits/jour depuis les opportunités | `POST /api/products/generate` |
| 3 | **Achat & expédition** | Achète chez le fournisseur et expédie au client, automatiquement | `POST /api/orders` |
| 4 | **Sourcing fournisseurs** | Recherche et classe les meilleurs fournisseurs pour un produit | `POST /api/search` |

Chaque pilier est disponible **à la demande** (API) **et en automatique** (tâches planifiées).

## Pile technique

| Couche          | Choix                                          |
| --------------- | ---------------------------------------------- |
| Langage         | TypeScript (Node.js ≥ 18)                      |
| API             | Express                                        |
| Base de données | Prisma ORM + SQLite (migrable vers PostgreSQL) |
| Validation      | Zod                                            |
| Automatisation  | node-cron + connecteurs de sources             |

## Démarrage rapide (l'application)

Toumai est une **application web installable** (PWA) : on la lance, on l'ouvre
dans le navigateur, et on peut **l'installer** comme une vraie application (sur le
bureau ou le téléphone) — elle fonctionne alors dans sa propre fenêtre.

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run db:push
npm start            # ← lance l'application
```

Puis ouvrez **http://localhost:3000**. Un bouton **« ⤓ Installer »** apparaît
dans la barre du haut (navigateurs compatibles) pour l'installer comme application.

### Connexion (comptes)

L'application est protégée par une **authentification**. Au premier lancement :

- Soit vous **créez un compte** depuis l'écran de connexion (le **premier compte
  créé devient administrateur**).
- Soit, après `npm run db:seed`, vous utilisez le compte de démonstration :
  **`admin@toumai.local` / `toumai1234`**.

Techniquement : jeton **JWT** signé (clé `JWT_SECRET`), mots de passe hachés en
**scrypt**. Toutes les routes `/api/*` exigent un jeton, sauf `/api/auth/*`,
`/health` et le webhook Stripe.

### L'interface

Une seule fenêtre, cinq onglets, et le **pilote automatique** en haut à droite :

| Onglet          | Ce qu'on y fait                                              |
| --------------- | ----------------------------------------------------------- |
| Tableau de bord | KPIs, finances (CA / coûts / **profit**), dernières commandes, bouton « Lancer un cycle » |
| Marché          | Analyser le marché · opportunités classées par score        |
| Produits        | Générer des produits en masse · catalogue                   |
| Fournisseurs    | Rechercher et classer les fournisseurs                      |
| Commandes       | Suivi des commandes et de leur statut                       |

Le bouton **« Démarrer le pilote »** lance l'automatisation en arrière-plan côté
serveur : l'application travaille alors seule (le tableau de bord se rafraîchit
tout seul), même si vous fermez l'onglet.

### Installable (PWA)

- **Manifeste** (`public/manifest.webmanifest`) + **icônes** + **service worker**
  (`public/sw.js`) → l'application est installable et garde sa coquille hors-ligne.
- Sur ordinateur : icône d'installation dans la barre d'adresse du navigateur.
- Sur mobile : « Ajouter à l'écran d'accueil ».

### Autres façons de lancer

| Commande            | Ce que ça fait                                        |
| ------------------- | ----------------------------------------------------- |
| `npm start`         | **L'application web** (recommandé)                    |
| `npm run autopilot` | Pilote automatique seul, en boucle (sans interface)   |
| `npm run cli`       | Version terminal (menu texte), sans navigateur        |

## 🛫 Pilote automatique (le logiciel tourne seul)

Toumai fonctionne en autonomie : une fois lancé, il analyse le marché, génère des
produits, encaisse des commandes et les expédie — **sans intervention**.

```bash
npm run autopilot   # enchaîne les cycles en continu (Ctrl+C pour arrêter)
```

Un cycle exécute, dans l'ordre : rafraîchissement fournisseurs → analyse marché →
génération de produits → (simulation de commandes clients) → achat & expédition →
traitement des recherches. Pilotage :

| Levier                         | Effet                                             |
| ------------------------------ | ------------------------------------------------- |
| `AUTOPILOT_RUN_ON_START=true`  | Cycle complet dès le démarrage du serveur         |
| `AUTOPILOT_INTERVAL_SECONDS`   | Cadence des cycles en mode `autopilot`            |
| `SIMULATE_DEMAND=true`         | Génère des commandes clients (démo bout en bout)  |
| `SIMULATED_ORDERS_PER_CYCLE`   | Nombre de commandes simulées par cycle            |
| `DEFAULT_MARKUP`, `PRODUCTS_PER_RUN`, `MIN_OPPORTUNITY_SCORE` | Règles métier    |

> En production, désactivez `SIMULATE_DEMAND` : les commandes proviennent alors de
> votre vraie boutique (webhook Shopify/WooCommerce/Stripe) au lieu du simulateur.

Déclencher un cycle à la demande : `POST /api/autopilot/run`.
Vue d'ensemble (opportunités, produits, commandes, chiffre d'affaires, profit
estimé) : `GET /api/dashboard`.

## Le seed de démonstration

```bash
npm run db:seed     # déroule les 4 piliers avec des données de démo
```

Analyse marché → génération de produits → commande client → **achat auto chez le
fournisseur + expédition** (avec numéro de suivi).

## Le flux automatisé de bout en bout

```
   [1] ANALYSE MARCHÉ            [2] GÉNÉRATION             [4] SOURCING
   Scanne les tendances    ->    Crée les produits    ->   Trouve le meilleur
   -> MarketOpportunity          -> Product (ACTIVE)        fournisseur/offre
        (score 0-100)                 (prix, marge)              |
                                                                 v
   [3] ACHAT & EXPÉDITION  <---  Commande client paye  <---  Produit en vente
   Bon d'achat fournisseur       (Order PAID)                 sur la boutique
   -> expédition + tracking
   -> Order SHIPPED
```

## Structure du projet

```
toumai/
├── public/                    # L'APPLICATION WEB (PWA)
│   ├── index.html             #   interface (onglets, tableau de bord)
│   ├── styles.css             #   thème professionnel (sombre)
│   ├── app.js                 #   logique client (appels API, rendu)
│   ├── manifest.webmanifest   #   manifeste PWA (installable)
│   ├── sw.js                  #   service worker (installabilité / hors-ligne)
│   └── icons/                 #   icônes de l'application
├── scripts/
│   └── make-icons.mjs         # génère les icônes PNG (npm run icons)
├── prisma/
│   ├── schema.prisma          # 10 tables (4 piliers + comptes)
│   └── seed.ts                # démonstration bout en bout
├── src/
│   ├── index.ts               # serveur : sert l'app web + l'API + planificateur
│   ├── app.ts                 # Express : fichiers statiques + routes API
│   ├── cli/                   # version terminal (menu texte) — optionnelle
│   │   ├── index.ts
│   │   └── ui.ts
│   ├── config/env.ts          # config (marge, quotas, crons)
│   ├── db/prisma.ts
│   ├── middleware/            # validation, gestion d'erreurs
│   ├── modules/
│   │   ├── market/            # [1] analyse marché + opportunités
│   │   ├── products/          # [2] catalogue + génération en masse
│   │   ├── orders/            # [3] commandes, clients, fulfillment
│   │   ├── suppliers/         # [4] fournisseurs + offres
│   │   └── search/            # [4] recherche + moteur de matching
│   ├── automation/
│   │   ├── scheduler.ts       # 5 tâches cron
│   │   ├── connectors/        # sources : market / supplier / fulfillment
│   │   └── jobs/              # 1 job par automatisation
│   └── utils/                 # scoring, pricing, opportunité, contenu produit
└── docs/
    ├── architecture.md
    ├── api.md
    └── user-flow.md
```

## Automatisation (tâches planifiées)

| Job                  | Pilier | Fréquence par défaut | Rôle                                        |
| -------------------- | ------ | -------------------- | ------------------------------------------- |
| `marketScan`         | 1      | toutes les 30 min    | Détecte de nouvelles opportunités           |
| `generateProducts`   | 2      | toutes les 6 h       | Publie des produits (quota configurable)    |
| `fulfillOrders`      | 3      | chaque minute        | Achète + expédie les commandes payées       |
| `refreshSuppliers`   | 4      | horaire              | Synchronise fournisseurs/offres/prix        |
| `runPendingSearches` | 4      | toutes les 2 min     | Traite les recherches en file               |
| `simulateDemand`     | 3      | toutes les 3 min     | (démo) crée des commandes clients           |

Planificateur intégré au serveur (`ENABLE_SCHEDULER=true`) ou lançable seul :

```bash
npm run worker
```

### Brancher de vraies sources

Tout passe par des **connecteurs** interchangeables (`src/automation/connectors/`).
Un **registre** (`registry.ts`) choisit automatiquement la source HTTP réelle si
les variables d'environnement sont fournies, sinon le connecteur de démonstration.

| Source        | Variables `.env`                          | Connecteur réel            |
| ------------- | ----------------------------------------- | -------------------------- |
| Marché        | `MARKET_API_URL` + `MARKET_API_KEY`       | `HttpMarketConnector`      |
| Fournisseurs  | `SUPPLIER_API_URL` + `SUPPLIER_API_KEY`   | `HttpSupplierConnector`    |
| Exécution     | `FULFILLMENT_API_URL` + `FULFILLMENT_API_KEY` | `HttpFulfillmentConnector` |

Sans ces variables, les connecteurs `mock-*` rendent le système pleinement
fonctionnel, sans aucune clé d'API. Pour un format de source spécifique, adaptez
la fonction `mapItem`/`mapSupplier` du connecteur HTTP concerné.

### Paiement par carte (Stripe)

Le paiement passe par **Stripe** (cartes Visa, Mastercard...). Renseignez
`STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` dans `.env` :

1. Créez une commande **non payée** (décochez « Marquer payée » dans l'UI) → statut `PENDING`.
2. Bouton **« 💳 Payer par carte »** → redirige vers la page sécurisée Stripe.
3. Après paiement, le **webhook** `POST /api/webhooks/stripe` marque la commande
   `PAID` → l'expédition s'enclenche automatiquement.

Sans clé Stripe, le paiement est simplement désactivé (les endpoints renvoient un
message clair) et le reste du logiciel fonctionne normalement.

> Test en local du webhook : `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
> (Stripe CLI) fournit un `STRIPE_WEBHOOK_SECRET` de test.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — architecture, modèle de données, algorithmes
- [`docs/api.md`](docs/api.md) — référence complète des endpoints
- [`docs/user-flow.md`](docs/user-flow.md) — flux utilisateur principal

## Scripts npm

| Script               | Rôle                                    |
| -------------------- | --------------------------------------- |
| `npm start`          | **L'application web** (PWA) + API        |
| `npm run cli`        | Version terminal (menu texte)           |
| `npm run autopilot`  | Pilote automatique seul (boucle)        |
| `npm run worker`     | Planificateur cron seul                 |
| `npm run icons`      | (Re)génère les icônes de l'application   |
| `npm run build`      | Compilation TypeScript                  |
| `npm run db:push`    | Applique le schéma                      |
| `npm run db:seed`    | Données de démonstration                |
| `npm run typecheck`  | Vérification des types                  |
