# Flux utilisateur principal

Toumai automatise le cycle complet du dropshipping. L'utilisateur (e-commerçant)
supervise ; le système exécute. Deux vues du même flux : **automatique** et **manuel**.

## Le flux automatisé (mode « pilote automatique »)

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                        BOUCLE D'AUTOMATISATION                           │
   │                                                                         │
   │  [1] marketScan (30 min)                                                │
   │        │  détecte des opportunités, calcule opportunityScore            │
   │        ▼                                                                │
   │  [2] generateProducts (6 h)                                             │
   │        │  publie les meilleures opportunités en produits ACTIVE         │
   │        ▼                                                                │
   │   Produits en vente sur la boutique  ──►  Client passe commande (PAID)  │
   │                                                    │                    │
   │  [3] fulfillOrders (1 min)  ◄──────────────────────┘                    │
   │        │  choisit le fournisseur (moteur pilier 4),                     │
   │        │  passe le bon d'achat, récupère le suivi                       │
   │        ▼                                                                │
   │   Commande SHIPPED (tracking transmis au client)                        │
   │                                                                         │
   │  [4] refreshSuppliers (1 h) — garde prix/stock fournisseurs à jour      │
   └─────────────────────────────────────────────────────────────────────────┘
```

L'e-commerçant configure une fois (marge, seuil d'opportunité, quotas dans `.env`),
puis surveille les tableaux de bord. Tout le reste tourne seul.

## Le flux manuel (contrôle pas à pas)

### Étape 1 — Trouver des produits gagnants (pilier 1)
`POST /api/market/scan` puis `GET /api/market/opportunities?minScore=70`.
L'utilisateur inspecte les scores (demande, tendance, concurrence) et marque
les opportunités à garder (`PATCH .../:id` → `EVALUATED`) ou à écarter (`REJECTED`).

### Étape 2 — Créer les fiches produits (pilier 2)
`POST /api/products/generate` génère titres, descriptions, images et prix
(marge appliquée automatiquement). Le résultat est un lot (`GenerationRun`)
consultable. Les produits peuvent être publiés directement (`autoPublish`) ou
révisés en `DRAFT` avant mise en ligne.

### Étape 3 — Sécuriser l'approvisionnement (pilier 4)
Pour un produit, `POST /api/search` classe les fournisseurs par score
(pertinence, prix, MOQ, délai, région, réputation, certifications). L'utilisateur
choisit ses partenaires et consulte leurs coordonnées (`GET /api/suppliers/:id`).

### Étape 4 — Vendre et livrer (pilier 3)
À chaque commande client (`POST /api/orders`, `markPaid: true`), le système
achète chez le meilleur fournisseur et déclenche l'expédition
(`POST /api/orders/:id/fulfill` ou via le job automatique). L'utilisateur suit
l'état (`GET /api/orders/:id`) : bons d'achat, transporteur, numéro de suivi.

### Étape 5 — Piloter
`GET /api/orders?status=SHIPPED`, `GET /api/products/generation-runs`,
`GET /api/market/opportunities` donnent la vision d'ensemble pour ajuster
la marge, le seuil d'opportunité ou les quotas.

## Personas

| Persona                 | Besoin principal                                        |
| ----------------------- | ------------------------------------------------------- |
| E-commerçant / dropshipper | Automatiser recherche produit → vente → livraison    |
| Responsable achats      | Comparer et sélectionner les fournisseurs               |
| Intégrateur technique   | Brancher de vraies sources via des connecteurs          |

## Cycle de vie des entités

- **Opportunité** : `NEW → EVALUATED → IMPORTED` (ou `REJECTED`)
- **Produit** : `DRAFT → ACTIVE → ARCHIVED`
- **Commande** : `PENDING → PAID → FULFILLING → SHIPPED → DELIVERED` (ou `CANCELLED`)
- **Bon d'achat** : `CREATED → PLACED → SHIPPED → DELIVERED` (ou `FAILED`)
