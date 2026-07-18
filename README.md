# Toumai — Système de recherche de fournisseurs

Toumai est un logiciel de **sourcing** : à partir d'un produit (ou de critères libres),
il recherche, note et classe les fournisseurs les plus pertinents. Le système est
composé d'une API REST, d'une base de données, d'un moteur de matching et d'une
couche d'automatisation (connecteurs de données + tâches planifiées).

## Pile technique

| Couche          | Choix                                             |
| --------------- | ------------------------------------------------- |
| Langage         | TypeScript (Node.js ≥ 18)                         |
| API             | Express                                            |
| Base de données | Prisma ORM + SQLite (migrable vers PostgreSQL)    |
| Validation      | Zod                                               |
| Automatisation  | node-cron (worker) + connecteurs de sources       |

## Démarrage rapide

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env

# 3. Base de données + client Prisma
npm run prisma:generate
npm run db:push

# 4. Données de démonstration (fournisseurs + produits)
npm run db:seed

# 5. Lancer l'API (avec le planificateur intégré)
npm run dev
```

L'API écoute par défaut sur `http://localhost:3000`.
Vérification : `curl http://localhost:3000/health`.

### Lancer une première recherche

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "sesame",
    "category": "agroalimentaire",
    "region": "Africa",
    "targetUnitPrice": 1.3,
    "targetQuantity": 2000,
    "requiredCertifications": "ISO9001"
  }'
```

Réponse : la liste des fournisseurs classés par score (0–100), avec le détail
de chaque critère (`breakdown`).

## Structure du projet

```
toumai/
├── prisma/
│   ├── schema.prisma          # Schéma de la base de données
│   └── seed.ts                # Peuplement de démonstration
├── src/
│   ├── index.ts               # Point d'entrée (serveur + scheduler)
│   ├── app.ts                 # Application Express, montage des routes
│   ├── config/env.ts          # Configuration (variables d'environnement)
│   ├── db/prisma.ts           # Client Prisma (singleton)
│   ├── middleware/            # Gestion d'erreurs, validation
│   ├── modules/
│   │   ├── products/          # CRUD Produits
│   │   ├── suppliers/         # CRUD Fournisseurs + Offres
│   │   └── search/            # Recherche + moteur de matching
│   ├── automation/
│   │   ├── scheduler.ts       # Tâches cron
│   │   ├── connectors/        # Sources de données fournisseurs
│   │   └── jobs/              # Jobs (refresh fournisseurs, recherches en file)
│   └── utils/
│       ├── logger.ts
│       └── scoring.ts         # Algorithme de scoring des fournisseurs
└── docs/
    ├── architecture.md        # Architecture & flux techniques
    ├── api.md                 # Référence des routes API
    └── user-flow.md           # Flux utilisateur principal
```

## Automatisation

Deux tâches tournent en arrière-plan (voir `src/automation`) :

1. **Rafraîchissement des fournisseurs** (`CRON_REFRESH_SUPPLIERS`, horaire par défaut)
   — interroge les connecteurs et synchronise la base fournisseurs/offres.
2. **Traitement des recherches en file** (`CRON_RUN_SEARCHES`, toutes les 2 min)
   — exécute les recherches soumises en mode asynchrone (`"async": true`).

Le planificateur est intégré au serveur (`ENABLE_SCHEDULER=true`) ou lançable seul :

```bash
npm run worker
```

Pour brancher une **vraie source** de fournisseurs, créez un connecteur dans
`src/automation/connectors/` qui implémente `SupplierConnector`, puis
enregistrez-le dans `refreshSuppliers.job.ts`.

## Scripts npm

| Script                 | Rôle                                       |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | API en mode watch                          |
| `npm run build`        | Compilation TypeScript                     |
| `npm start`            | API compilée (`dist/`)                     |
| `npm run worker`       | Planificateur seul                         |
| `npm run db:push`      | Applique le schéma à la base               |
| `npm run db:seed`      | Peuple des données de démonstration        |
| `npm run typecheck`    | Vérification des types                     |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — architecture, moteur de scoring, automatisation
- [`docs/api.md`](docs/api.md) — référence complète des endpoints
- [`docs/user-flow.md`](docs/user-flow.md) — flux utilisateur principal
