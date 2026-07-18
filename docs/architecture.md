# Architecture

Toumai est une plateforme d'automatisation de dropshipping structurée autour de
**4 piliers**, chacun exposé en API et automatisé par une tâche planifiée.

## Vue d'ensemble

```
                         ┌──────────────────────────────────────────┐
                         │              API Express                  │
                         │  /market  /products  /orders  /suppliers  /search │
                         └───┬─────────┬─────────┬──────────┬────────┘
                             │         │         │          │
        ┌────────────────────▼──┐ ┌────▼─────┐ ┌─▼────────┐ ┌▼───────────────┐
        │ [1] Market service    │ │[2] Génér.│ │[3] Orders│ │[4] Suppliers /  │
        │  opportunityScore()   │ │ pricing  │ │fulfillment│ │ search scoring  │
        └───────────┬───────────┘ └────┬─────┘ └────┬─────┘ └───────┬────────┘
                    │                   │            │               │
                    └───────────────────┴─────┬──────┴───────────────┘
                                              │
                              ┌───────────────▼───────────────┐
                              │   Prisma ORM → SQLite/Postgres │
                              └───────────────▲───────────────┘
                                              │
        ┌─────────────────────────────────────┴──────────────────────────────┐
        │                     Automatisation (node-cron)                      │
        │  marketScan │ generateProducts │ fulfillOrders │ refreshSuppliers │ runSearches │
        │      │               │                 │               │                        │
        │  ┌───▼───┐       ┌───▼────┐        ┌───▼─────┐    ┌────▼────┐                   │
        │  │Market │       │Pricing/│        │Fulfil.  │    │Supplier │  (connecteurs)    │
        │  │connec.│       │Content │        │connec.  │    │connec.  │                   │
        │  └───────┘       └────────┘        └─────────┘    └─────────┘                   │
        └─────────────────────────────────────────────────────────────────────┘
```

## Modèle de données (10 tables)

| Table               | Pilier | Rôle                                                     |
| ------------------- | ------ | -------------------------------------------------------- |
| `User`              | —      | Comptes / authentification (JWT + mot de passe scrypt)   |
| `MarketOpportunity` | 1      | Produit gagnant détecté + scores (demande/tendance/concurrence) |
| `Product`           | 2      | Produit du catalogue (prix d'achat/vente, marge, statut) |
| `GenerationRun`     | 2      | Traçabilité d'un lot de génération                       |
| `Customer`          | 3      | Client final                                             |
| `Order` / `OrderItem` | 3    | Commande client et ses lignes                            |
| `PurchaseOrder`     | 3      | Bon d'achat fournisseur (suivi d'expédition)             |
| `Supplier` / `Offer` | 4     | Fournisseur et ses offres (prix, MOQ, délai)             |
| `SearchRequest` / `SupplierMatch` | 4 | Recherche de fournisseurs et résultats classés  |

Schéma faisant autorité : [`prisma/schema.prisma`](../prisma/schema.prisma).

## Pilier 1 — Analyse marché

`marketService.scan()` interroge les `MarketConnector` et upsert des
`MarketOpportunity`. Chaque opportunité reçoit un **score d'opportunité 0–100**
(`utils/opportunity.ts`) :

```
score = 0.40 · demande + 0.35 · tendance + 0.25 · (100 − concurrence)
```

Déduplication par `(source, externalId)`. Un re-scan met à jour les signaux
sans écraser le statut (ex: une opportunité déjà `IMPORTED` le reste).

## Pilier 2 — Génération de produits

`generationService.generate()` sélectionne les meilleures opportunités
(`status ∈ {NEW, EVALUATED}`, score ≥ seuil), puis pour chacune :

- génère titre/description/SKU/images (`utils/productContent.ts`) ;
- calcule le prix de vente et la marge (`utils/pricing.ts`, markup configurable) ;
- crée le `Product` (DRAFT ou ACTIVE) et passe l'opportunité en `IMPORTED`.

Chaque exécution est tracée dans un `GenerationRun` (demandés/générés/ignorés/échoués).
Le quota par cycle est plafonné par `PRODUCTS_PER_RUN`.

## Pilier 3 — Achat & expédition

`orderService.create()` construit la commande et calcule le total. Quand une
commande est `PAID`, `fulfillmentService.fulfillOrder()` :

1. passe la commande en `FULFILLING` ;
2. pour chaque article, choisit le meilleur couple (fournisseur, offre) via le
   moteur de scoring (`utils/scoring.ts`) ;
3. crée un `PurchaseOrder` et le passe via le `FulfillmentConnector` ;
4. enregistre le numéro de suivi ; la commande passe `SHIPPED` si tous les
   bons d'achat sont acceptés (sinon reste `FULFILLING` pour réessai).

Cycle commande : `PENDING → PAID → FULFILLING → SHIPPED → DELIVERED` (ou `CANCELLED`).

## Pilier 4 — Sourcing fournisseurs

`searchService` + moteur de matching (`utils/scoring.ts`). Score global 0–100,
moyenne pondérée de 7 critères :

| Critère | Poids | | Critère | Poids |
|---|---|---|---|---|
| pertinence | 30 % | | région | 10 % |
| prix | 20 % | | réputation | 10 % |
| MOQ | 10 % | | certifications | 10 % |
| délai | 10 % | | | |

Recherche synchrone (résultats immédiats) ou asynchrone (file traitée par le
worker). Le même moteur sert aussi à choisir le fournisseur lors du fulfillment.

## Connecteurs (intégrations externes)

Trois familles de connecteurs, toutes remplaçables sans toucher au métier :

| Famille       | Interface             | Mock fourni                | Vraie source visée             |
| ------------- | --------------------- | -------------------------- | ------------------------------ |
| Marché        | `MarketConnector`     | `MockMarketConnector`      | API tendances, marketplaces    |
| Fournisseurs  | `SupplierConnector`   | `MockConnector`            | Annuaires B2B, marketplaces    |
| Exécution     | `FulfillmentConnector`| `MockFulfillmentConnector` | API du fournisseur / EDI       |

## Évolutions possibles

- SQLite → PostgreSQL (changer `provider` + `DATABASE_URL`).
- Génération de contenu par LLM (Claude API) dans `utils/productContent.ts`.
- File d'attente dédiée (BullMQ/Redis) au lieu du cron pour la montée en charge.
- Authentification / multi-boutique (clé API, JWT) sur les routes.
- Webhooks de paiement (Stripe) déclenchant le passage en `PAID`.
- Synchronisation catalogue vers Shopify/WooCommerce.
