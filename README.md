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

## Démarrage rapide (le logiciel)

Toumai est avant tout un **logiciel qu'on lance dans le terminal** : un menu
interactif d'où l'on pilote toute l'automatisation (pas besoin de navigateur).

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run db:push
npm start            # ← lance le logiciel (menu interactif)
```

```
╔══════════════════════════════════════════════════════════╗
║   TOUMAI — Logiciel d’automatisation e-commerce          ║
╚══════════════════════════════════════════════════════════╝

  Pilote automatique : ○ arrêté

  1  Tableau de bord
  2  Lancer un cycle complet maintenant
  3  Démarrer le pilote automatique
  4  [1] Analyser le marché
  5  [2] Générer des produits
  6  [4] Rechercher des fournisseurs
  7  [3] Voir les commandes
  8  Voir les produits
  0  Quitter
```

Depuis ce menu on lance l'analyse marché, on génère des produits, on cherche des
fournisseurs, on suit les commandes et le chiffre d'affaires, et on active le
**pilote automatique** (le logiciel travaille alors seul en arrière-plan).

### Autres façons de lancer

| Commande         | Ce que ça fait                                         |
| ---------------- | ------------------------------------------------------ |
| `npm start`      | **Le logiciel** — menu interactif (recommandé)         |
| `npm run autopilot` | Pilote automatique seul, en boucle, sans menu       |
| `npm run serve`  | Serveur API (HTTP) pour intégrer Toumai à un autre outil |

> Le serveur API (`npm run serve`) reste disponible pour brancher Toumai à une
> boutique ou un autre système ; ce n'est pas une interface web à utiliser au
> quotidien. L'usage normal, c'est le logiciel `npm start`.

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
├── prisma/
│   ├── schema.prisma          # 9 tables couvrant les 4 piliers
│   └── seed.ts                # démonstration bout en bout
├── src/
│   ├── cli/                   # LE LOGICIEL : application terminal interactive
│   │   ├── index.ts           #   menu principal + actions
│   │   └── ui.ts              #   affichage (couleurs, tableaux)
│   ├── index.ts               # serveur API (intégration) + planificateur
│   ├── app.ts                 # montage des routes Express
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

Tout passe par des **connecteurs** interchangeables (`src/automation/connectors/`) :

- **Marché** — implémentez `MarketConnector.discover()` (API tendances/marketplace).
- **Fournisseurs** — implémentez `SupplierConnector.fetchSuppliers()` (annuaire B2B).
- **Exécution** — implémentez `FulfillmentConnector.placeOrder()` (API du fournisseur).

Les connecteurs `mock-*` fournis servent de référence et rendent le système
fonctionnel immédiatement, sans clé d'API externe.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — architecture, modèle de données, algorithmes
- [`docs/api.md`](docs/api.md) — référence complète des endpoints
- [`docs/user-flow.md`](docs/user-flow.md) — flux utilisateur principal

## Scripts npm

| Script               | Rôle                                    |
| -------------------- | --------------------------------------- |
| `npm start`          | **Le logiciel** — menu interactif       |
| `npm run autopilot`  | Pilote automatique seul (boucle)        |
| `npm run serve`      | Serveur API HTTP (intégration)          |
| `npm run worker`     | Planificateur cron seul                 |
| `npm run build`      | Compilation TypeScript                  |
| `npm run db:push`    | Applique le schéma                      |
| `npm run db:seed`    | Données de démonstration                |
| `npm run typecheck`  | Vérification des types                  |
