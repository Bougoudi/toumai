# Référence API

Base URL : `http://localhost:3000`
Format : JSON. Les erreurs de validation renvoient `400` avec `details`.

## Système

| Méthode | Route     | Description             |
| ------- | --------- | ----------------------- |
| GET     | `/health` | État du service         |
| GET     | `/api`    | Index des endpoints     |

## Produits — `/api/products`

| Méthode | Route                | Description                    |
| ------- | -------------------- | ------------------------------ |
| GET     | `/api/products`      | Liste (filtres `category`, `q`, pagination `take`/`skip`) |
| POST    | `/api/products`      | Créer un produit               |
| GET     | `/api/products/:id`  | Détail                         |
| PATCH   | `/api/products/:id`  | Mise à jour partielle          |
| DELETE  | `/api/products/:id`  | Suppression                    |

**Corps (création)**
```json
{
  "sku": "AGRO-SESAME-001",
  "name": "Graines de sésame",
  "category": "agroalimentaire",
  "keywords": "sesame,graines,bio",
  "targetUnitPrice": 1.3,
  "targetQuantity": 2000,
  "region": "Africa",
  "requiredCertifications": "ISO9001"
}
```

## Fournisseurs — `/api/suppliers`

| Méthode | Route                       | Description                                   |
| ------- | --------------------------- | --------------------------------------------- |
| GET     | `/api/suppliers`            | Liste (`region`, `q`, `minRating`, `verified`)|
| POST    | `/api/suppliers`            | Créer un fournisseur (+ offres imbriquées)    |
| GET     | `/api/suppliers/:id`        | Détail + offres                               |
| PATCH   | `/api/suppliers/:id`        | Mise à jour partielle                         |
| DELETE  | `/api/suppliers/:id`        | Suppression                                   |
| POST    | `/api/suppliers/:id/offers` | Ajouter une offre                             |

**Corps (création)**
```json
{
  "name": "Sahel Agro Supplies",
  "region": "Africa",
  "country": "Tchad",
  "rating": 4.6,
  "verified": true,
  "certifications": "ISO9001,HACCP",
  "leadTimeDays": 14,
  "offers": [
    { "title": "Graines de sésame bio", "category": "agroalimentaire",
      "keywords": "sesame,graines,bio", "unitPrice": 1.2, "moq": 1000 }
  ]
}
```

## Recherche — `/api/search`

| Méthode | Route              | Description                                    |
| ------- | ------------------ | ---------------------------------------------- |
| POST    | `/api/search`      | Lance une recherche (synchrone ou en file)     |
| GET     | `/api/search`      | Historique des recherches (`status`, pagination)|
| GET     | `/api/search/:id`  | Une recherche + ses résultats classés          |

**Corps** — au moins un de `productId`, `query`, `category`, `keywords` requis.
```json
{
  "productId": "cmr...",          // optionnel : hérite des critères du produit
  "query": "sesame",
  "category": "agroalimentaire",
  "keywords": "sesame,bio",
  "targetUnitPrice": 1.3,
  "targetQuantity": 2000,
  "region": "Africa",
  "requiredCertifications": "ISO9001",
  "limit": 20,
  "async": false                  // true → traitement par le worker (HTTP 202)
}
```

**Réponse (synchrone)**
```json
{
  "request": { "id": "...", "status": "COMPLETED" },
  "criteria": { "...": "critères normalisés" },
  "results": [
    {
      "rank": 1,
      "supplier": { "id": "...", "name": "Sahel Agro Supplies", "rating": 4.6 },
      "offer": { "title": "Graines de sésame bio", "unitPrice": 1.19, "moq": 1000 },
      "breakdown": {
        "relevance": 100, "price": 100, "moq": 100, "leadTime": 76,
        "region": 100, "reputation": 93, "certifications": 100, "total": 96
      }
    }
  ]
}
```

**Réponse (asynchrone, HTTP 202)** — récupérer ensuite via `GET /api/search/:id`.
```json
{
  "message": "Recherche mise en file. Interrogez /api/search/:id pour les résultats.",
  "request": { "id": "...", "status": "PENDING" }
}
```

## Codes de statut

| Code | Sens                                   |
| ---- | -------------------------------------- |
| 200  | Succès                                 |
| 201  | Ressource créée                        |
| 202  | Recherche acceptée (traitement en file)|
| 204  | Suppression réussie                    |
| 400  | Validation échouée                     |
| 404  | Ressource introuvable                  |
| 500  | Erreur interne                         |
