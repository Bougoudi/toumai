# Architecture

## Vue d'ensemble

```
                    ┌─────────────────────────────────────────────┐
                    │                  Client                      │
                    │        (web, mobile, autre service)          │
                    └───────────────────────┬─────────────────────┘
                                            │ HTTP / JSON
                    ┌───────────────────────▼─────────────────────┐
                    │                API Express                   │
                    │   /api/products   /api/suppliers   /api/search│
                    └───────┬───────────────┬──────────────┬───────┘
                            │               │              │
                    ┌───────▼───┐   ┌───────▼────┐  ┌──────▼───────┐
                    │  Produits │   │Fournisseurs│  │   Recherche  │
                    │  service  │   │  service   │  │   service    │
                    └───────┬───┘   └───────┬────┘  └──────┬───────┘
                            │               │              │
                            │               │      ┌───────▼────────┐
                            │               │      │ Moteur scoring │
                            │               │      │ (utils/scoring)│
                            │               │      └───────┬────────┘
                    ┌───────▼───────────────▼──────────────▼───────┐
                    │           Prisma ORM  →  SQLite / Postgres    │
                    └───────────────────────▲──────────────────────┘
                                            │
                    ┌───────────────────────┴─────────────────────┐
                    │            Automatisation (cron)             │
                    │  refreshSuppliers  │  runPendingSearches     │
                    │         ▲                                    │
                    │  ┌──────┴───────┐                            │
                    │  │ Connecteurs  │  (mock, API B2B, CSV...)   │
                    │  └──────────────┘                            │
                    └──────────────────────────────────────────────┘
```

## Modèle de données

| Table            | Rôle                                                              |
| ---------------- | ---------------------------------------------------------------- |
| `Product`        | Produit recherché et ses critères de sourcing cibles.            |
| `Supplier`       | Fournisseur (note, région, certifications, délais...).           |
| `Offer`          | Produit proposé par un fournisseur (prix, MOQ, délai, stock).    |
| `SearchRequest`  | Demande de recherche (synchrone ou en file), avec son statut.    |
| `SupplierMatch`  | Résultat classé : fournisseur candidat + score + détail.         |

Relations : `Supplier 1—N Offer`, `SearchRequest 1—N SupplierMatch`,
`SupplierMatch N—1 Supplier/Offer`, `Product 1—N SearchRequest`.

Le schéma fait autorité : [`prisma/schema.prisma`](../prisma/schema.prisma).

## Moteur de matching (`src/utils/scoring.ts`)

Chaque fournisseur reçoit un **score global 0–100**, moyenne pondérée de
sept critères. La meilleure offre du fournisseur est utilisée pour les critères
liés au produit (prix, MOQ, délai).

| Critère          | Poids | Logique                                                    |
| ---------------- | ----- | ---------------------------------------------------------- |
| `relevance`      | 30 %  | Recouvrement mots-clés (70 %) + correspondance catégorie (30 %) |
| `price`          | 20 %  | Score max si prix ≤ cible, décroît avec le dépassement     |
| `moq`            | 10 %  | Score max si MOQ ≤ quantité voulue                          |
| `leadTime`       | 10 %  | Décroît linéairement jusqu'à 60 jours                      |
| `region`         | 10 %  | Correspondance de région/pays                              |
| `reputation`     | 10 %  | Note /5 (80 %) + bonus « vérifié » (20 %)                  |
| `certifications` | 10 %  | Part des certifications requises couvertes                 |

Un critère « inconnu » (donnée absente) est neutre (0,5) plutôt que pénalisant.
Les poids se modifient dans la constante `WEIGHTS`. Le détail (`breakdown`) est
renvoyé et stocké pour être audité et affiché dans l'UI.

## Exécution des recherches

Deux modes, via le champ `async` du corps de la requête `POST /api/search` :

- **Synchrone** (`async: false`, défaut) — calcule immédiatement, persiste les
  `SupplierMatch`, renvoie les résultats dans la réponse.
- **Asynchrone** (`async: true`) — crée une `SearchRequest` en statut `PENDING`
  (HTTP 202). Le job `runPendingSearches` la traite au prochain cycle cron.
  Le client récupère les résultats via `GET /api/search/:id`.

Cycle de vie d'une recherche : `PENDING → RUNNING → COMPLETED` (ou `FAILED`).

## Automatisation (`src/automation`)

- **Connecteurs** (`connectors/`) — implémentent `SupplierConnector` et renvoient
  des fournisseurs normalisés. `MockConnector` sert de référence/démonstration.
- **Jobs** (`jobs/`) — `refreshSuppliers` (upsert idempotent des fournisseurs) et
  `runPendingSearches` (traitement par lots des recherches en file).
- **Scheduler** (`scheduler.ts`) — planifie les jobs via cron. Intégré au serveur
  ou exécutable seul (`npm run worker`) pour séparer API et traitements lourds.

## Évolutions possibles

- Passer SQLite → PostgreSQL (changer `provider` + `DATABASE_URL`).
- Authentification / multi-tenant (clé API, JWT) sur les routes.
- Connecteurs réels (annuaires B2B, marketplaces) + déduplication par `externalId`.
- File d'attente dédiée (BullMQ/Redis) à la place du cron pour la montée en charge.
- Enrichissement du scoring (embeddings sémantiques pour la pertinence textuelle).
