# Référence API

Base URL : `http://localhost:3000` · Format : JSON.
Validation par Zod → `400` avec `details` en cas d'erreur.

## Système

| Méthode | Route     | Description         |
| ------- | --------- | ------------------- |
| GET     | `/health` | État du service     |
| GET     | `/api`    | Index des 4 piliers |

## Pilote automatique & tableau de bord

| Méthode | Route                  | Description                                        |
| ------- | ---------------------- | ------------------------------------------------- |
| GET     | `/api/dashboard`       | Vue d'ensemble : opportunités, produits, commandes, CA, profit estimé |
| GET     | `/api/autopilot`       | État du pilote (`running`, `intervalSeconds`, `lastRunAt`, `lastReport`) |
| POST    | `/api/autopilot/run`   | Déclenche un **cycle complet** des 4 piliers à la demande |
| POST    | `/api/autopilot/start` | Démarre le pilote en arrière-plan (cycles réguliers) |
| POST    | `/api/autopilot/stop`  | Arrête le pilote en arrière-plan                  |

> L'application web (PWA) est servie à la racine `/` par ce même serveur ;
> `/api/*` fournit les données consommées par l'interface.

`POST /api/autopilot/run` renvoie un rapport de cycle :
```json
{
  "message": "Cycle du pilote automatique exécuté",
  "report": {
    "opportunities": 18, "productsGenerated": 13, "suppliers": 7,
    "ordersCreated": 3, "ordersFulfilled": 3, "searchesProcessed": 0,
    "durationMs": 514
  }
}
```

---

## Pilier 1 — Analyse marché · `/api/market`

| Méthode | Route                          | Description                              |
| ------- | ------------------------------ | ---------------------------------------- |
| POST    | `/api/market/scan`             | Lance une analyse (filtres `category`, `region`, `limit`) |
| GET     | `/api/market/opportunities`    | Liste (`status`, `category`, `minScore`, pagination) |
| GET     | `/api/market/opportunities/:id`| Détail d'une opportunité                 |
| PATCH   | `/api/market/opportunities/:id`| Change le statut (`NEW`/`EVALUATED`/`IMPORTED`/`REJECTED`) |

Une opportunité expose `demandScore`, `competitionScore`, `trendScore`,
`opportunityScore` (0–100) et une estimation de prix/marge.

---

## Pilier 2 — Produits & génération · `/api/products`

| Méthode | Route                            | Description                                |
| ------- | -------------------------------- | ------------------------------------------ |
| POST    | `/api/products/generate`         | **Génération en masse** depuis les opportunités |
| GET     | `/api/products/generation-runs`  | Historique des lots de génération          |
| GET     | `/api/products/generation-runs/:id` | Détail d'un lot                         |
| GET     | `/api/products`                  | Liste (`category`, `status`, `q`, pagination) |
| POST    | `/api/products`                  | Créer un produit manuellement              |
| GET     | `/api/products/:id`              | Détail                                     |
| PATCH   | `/api/products/:id`              | Mise à jour partielle                      |
| DELETE  | `/api/products/:id`              | Suppression                                |

**Corps (génération)**
```json
{ "limit": 200, "minScore": 60, "category": "electronique", "autoPublish": true }
```
Réponse : un `GenerationRun` (`requested`, `generated`, `skipped`, `failed`).

---

## Pilier 3 — Commandes, clients, exécution · `/api/orders`

| Méthode | Route                     | Description                                  |
| ------- | ------------------------- | -------------------------------------------- |
| POST    | `/api/orders/customers`   | Créer un client                              |
| GET     | `/api/orders/customers`   | Lister les clients                           |
| POST    | `/api/orders`             | Créer une commande (client existant ou à la volée) |
| GET     | `/api/orders`             | Liste (`status`, pagination)                 |
| GET     | `/api/orders/:id`         | Détail + bons d'achat fournisseurs           |
| POST    | `/api/orders/:id/cancel`  | Annuler (si non expédiée)                    |
| POST    | `/api/orders/:id/fulfill` | **Forcer l'achat + expédition** immédiats    |

**Corps (commande)**
```json
{
  "customer": { "name": "Aïcha", "email": "aicha@example.com",
                "city": "Lyon", "country": "France" },
  "items": [ { "productId": "cmr...", "quantity": 3 } ],
  "markPaid": true
}
```
Si `markPaid: true`, la commande est honorée automatiquement au prochain cycle
`fulfillOrders` (ou immédiatement via `/fulfill`). Chaque bon d'achat porte un
`trackingNumber` et un `carrier`.

---

## Pilier 4 — Fournisseurs & recherche · `/api/suppliers`, `/api/search`

| Méthode | Route                       | Description                               |
| ------- | --------------------------- | ----------------------------------------- |
| GET     | `/api/suppliers`            | Liste (`region`, `q`, `minRating`, `verified`) |
| POST    | `/api/suppliers`            | Créer (offres imbriquées)                 |
| GET     | `/api/suppliers/:id`        | Détail + offres                           |
| PATCH   | `/api/suppliers/:id`        | Mise à jour                               |
| DELETE  | `/api/suppliers/:id`        | Suppression                               |
| POST    | `/api/suppliers/:id/offers` | Ajouter une offre                         |
| POST    | `/api/search`               | Rechercher des fournisseurs (sync ou file)|
| GET     | `/api/search`               | Historique des recherches                 |
| GET     | `/api/search/:id`           | Une recherche + résultats classés         |

**Corps (recherche)** — au moins un de `productId`, `query`, `category`, `keywords`.
```json
{
  "query": "sesame", "category": "agroalimentaire", "region": "Africa",
  "targetUnitPrice": 1.3, "targetQuantity": 2000,
  "requiredCertifications": "ISO9001", "limit": 20, "async": false
}
```
Réponse : fournisseurs classés par `score` (0–100) avec `breakdown` par critère.

---

## Codes de statut

| Code | Sens                    | | Code | Sens                    |
| ---- | ----------------------- |-| ---- | ----------------------- |
| 200  | Succès                  | | 400  | Validation échouée      |
| 201  | Ressource créée         | | 404  | Introuvable             |
| 202  | Accepté (traité en file)| | 409  | Conflit (ex: annulation)|
| 204  | Suppression réussie     | | 500  | Erreur interne          |
