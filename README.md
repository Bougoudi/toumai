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

## Démarrage rapide

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run db:push
npm run dev         # API + pilote automatique sur http://localhost:3000
```

Au démarrage, le serveur exécute **immédiatement un cycle complet** (les 4 piliers
s'enchaînent) puis continue seul via le planificateur. Consultez le résultat en
direct : `curl http://localhost:3000/api/dashboard`.

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
│   ├── index.ts               # serveur + planificateur
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

| Script               | Rôle                              |
| -------------------- | --------------------------------- |
| `npm run dev`        | API + pilote automatique (watch)  |
| `npm run autopilot`  | Pilote automatique seul (boucle)  |
| `npm run worker`     | Planificateur cron seul           |
| `npm run build`      | Compilation TypeScript            |
| `npm run db:push`    | Applique le schéma                |
| `npm run db:seed`    | Données de démonstration          |
| `npm run typecheck`  | Vérification des types            |
