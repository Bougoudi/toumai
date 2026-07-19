# Référence API

Base URL : `http://localhost:3000` · Format : JSON.
Validation par Zod → `400` avec `details` en cas d'erreur.

## Système

| Méthode | Route     | Description         |
| ------- | --------- | ------------------- |
| GET     | `/health` | État du service     |
| GET     | `/api`    | Index des 4 piliers |

## Authentification — `/api/auth`

Toutes les routes `/api/*` exigent l'en-tête `Authorization: Bearer <jeton>`,
**sauf** `/api/auth/*`, `/health` et `/api/webhooks/stripe`.

| Méthode | Route                | Description                                    |
| ------- | -------------------- | ---------------------------------------------- |
| POST    | `/api/auth/register` | Crée un compte (1er compte = admin) → `{ token, user }` |
| POST    | `/api/auth/login`    | Connexion → `{ token, user }`                  |
| GET     | `/api/auth/me`       | Profil de l'utilisateur connecté (jeton requis) |

**Corps (inscription)**
```json
{ "name": "Aïcha", "email": "aicha@exemple.com", "password": "motdepasse1" }
```
Le jeton est un **JWT** (HS256) signé avec `JWT_SECRET` ; les mots de passe sont
hachés en **scrypt**. Une requête protégée sans jeton valide renvoie `401`.

### Double authentification (2FA) — `/api/auth/mfa`

Si un second facteur est activé, `login` renvoie `{ mfaRequired: true, mfaToken, methods }`
(aucun accès tant que le 2e facteur n'est pas validé).

| Méthode | Route                                      | Description                                    |
| ------- | ------------------------------------------ | ---------------------------------------------- |
| GET     | `/api/auth/mfa/status`                     | Facteurs activés (TOTP, codes, clés)           |
| POST    | `/api/auth/mfa/totp/setup`                 | Démarre le TOTP → `qrDataUrl` + `secret`       |
| POST    | `/api/auth/mfa/totp/enable`                | Active après vérif `{ code }` → codes de récupération |
| POST    | `/api/auth/mfa/totp/disable`               | Désactive le TOTP                              |
| POST    | `/api/auth/mfa/recovery/regenerate`        | Régénère les codes de récupération             |
| POST    | `/api/auth/mfa/webauthn/register/options`  | Options d'enregistrement d'une clé (WebAuthn)  |
| POST    | `/api/auth/mfa/webauthn/register/verify`   | Enregistre la clé `{ response, name }`         |
| DELETE  | `/api/auth/mfa/webauthn/:id`               | Retire une clé de sécurité                     |
| POST    | `/api/auth/mfa/verify`                     | Étape 2 : `{ mfaToken, method: totp\|recovery, code }` → jeton |
| POST    | `/api/auth/mfa/webauthn/auth/options`      | Étape 2 : options d'authentification par clé   |
| POST    | `/api/auth/mfa/webauthn/auth/verify`       | Étape 2 : `{ mfaToken, response }` → jeton     |

Facteurs : **TOTP** (app d'authentification), **clés de sécurité / passkeys**
(WebAuthn), **codes de récupération** à usage unique. **Aucun SMS** (anti SIM-swap).
Le secret TOTP et les codes de récupération sont **chiffrés** en base.

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

## Paramètres — `/api/settings`

| Méthode | Route              | Description                                  |
| ------- | ------------------ | -------------------------------------------- |
| GET     | `/api/settings`    | Réglages courants + valeurs par défaut       |
| PATCH   | `/api/settings`    | Modifier (marge, score min, quota, devise, cadence pilote, demande simulée) |
| POST    | `/api/settings/reset` | Restaurer les valeurs par défaut          |

## Compétiteurs — `/api/competitors`

| Méthode | Route                                   | Description                          |
| ------- | --------------------------------------- | ------------------------------------ |
| GET     | `/api/competitors`                      | Boutiques concurrentes suivies       |
| POST    | `/api/competitors`                      | Ajouter une boutique `{ platform, shopName, followed }` |
| POST    | `/api/competitors/:id/scan`             | Scanner les ventes récentes          |
| PATCH   | `/api/competitors/:id/follow`           | Suivre / ne plus suivre              |
| DELETE  | `/api/competitors/:id`                  | Retirer                              |
| GET     | `/api/competitors/winning`              | Produits gagnants (triés par ventes) |
| POST    | `/api/competitors/products/:id/favorite`| Ajouter un produit gagnant aux favoris |

## Recherche & favoris — `/api/discovery`, `/api/favorites`

| Méthode | Route                                | Description                            |
| ------- | ------------------------------------ | -------------------------------------- |
| GET     | `/api/discovery/search/text?q=`      | Recherche par écriture                 |
| POST    | `/api/discovery/search/photo`        | Recherche par photo (`{ hint }`)       |
| GET     | `/api/discovery/search/barcode/:code`| Recherche par code-barres              |
| GET/POST/DELETE | `/api/favorites`             | Gérer les favoris                      |
| POST    | `/api/favorites/:id/source`          | Transformer en produit + trouver le fournisseur |
| POST    | `/api/favorites/:id/publish/:channelId` | Sourcer puis publier sur un canal   |

## Outils, publicités, tableur

| Méthode | Route                     | Description                               |
| ------- | ------------------------- | ----------------------------------------- |
| POST    | `/api/tools/titles`       | Génère des titres optimisés               |
| GET     | `/api/ads`                | Liste des publicités                      |
| POST    | `/api/ads/generate`       | Génère une pub pour un produit            |
| PATCH   | `/api/ads/:id/status`     | DRAFT / ACTIVE / PAUSED                    |
| GET     | `/api/reports/pnl`        | Compte de résultat (revenus/coûts/bénéfices) |
| GET     | `/api/reports/pnl.csv`    | Export CSV du tableur                     |

## Canaux de vente — `/api/channels` (Etsy / eBay / Amazon)

| Méthode | Route                                   | Description                              |
| ------- | --------------------------------------- | ---------------------------------------- |
| GET     | `/api/channels/types`                   | Canaux disponibles + champs de config    |
| GET     | `/api/channels`                         | Liste des canaux connectés (config masquée) |
| POST    | `/api/channels`                         | Connecter un canal `{ type, name, config }` (teste les identifiants) |
| PATCH   | `/api/channels/:id`                     | Mettre à jour la config et re-tester     |
| DELETE  | `/api/channels/:id`                     | Déconnecter un canal                     |
| POST    | `/api/channels/:id/test`                | Re-tester la connexion                   |
| POST    | `/api/channels/:id/sync`                | Importer les commandes du canal          |
| POST    | `/api/channels/:id/publish/:productId`  | Publier un produit en annonce            |

Les commandes importées (statut `PAID`) déclenchent l'achat & expédition
automatiques. Un job `syncChannels` importe les commandes de tous les canaux
connectés toutes les 5 min. Les identifiants (`config`) ne sont jamais renvoyés
en clair par l'API (valeurs secrètes masquées).

**Ce que chaque canal exige** (identifiants développeur à créer côté plateforme) :
- **Etsy** : `apiKey` (keystring), `accessToken` (OAuth2), `shopId`.
- **eBay** : `accessToken` (OAuth2) + IDs de politiques (fulfillment/payment/return) + `merchantLocationKey`.
- **Amazon** : `lwaClientId`, `lwaClientSecret`, `refreshToken`, `region`, `marketplaceId`, `sellerId` (compte vendeur Pro + SP-API validée).

## Paiement — `/api/payments` (Stripe)

| Méthode | Route                            | Description                                   |
| ------- | -------------------------------- | --------------------------------------------- |
| GET     | `/api/payments/status`           | Indique si le paiement est configuré (`enabled`) |
| POST    | `/api/payments/checkout/:orderId`| Crée une session Stripe Checkout → renvoie `{ url }` |
| POST    | `/api/webhooks/stripe`           | Webhook Stripe (corps brut, signature vérifiée) |

- La commande doit être en statut `PENDING`. Le webhook `checkout.session.completed`
  la passe en `PAID`, ce qui déclenche l'expédition automatique.
- Sans `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, ces endpoints renvoient `501`
  avec un message explicite ; le reste du logiciel fonctionne normalement.

## Codes de statut

| Code | Sens                    | | Code | Sens                    |
| ---- | ----------------------- |-| ---- | ----------------------- |
| 200  | Succès                  | | 400  | Validation échouée      |
| 201  | Ressource créée         | | 404  | Introuvable             |
| 202  | Accepté (traité en file)| | 409  | Conflit (ex: annulation)|
| 204  | Suppression réussie     | | 500  | Erreur interne          |
|      |                         | | 501  | Fonction non configurée (ex: Stripe) |
