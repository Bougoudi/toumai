# TOUMA — place de marché du commerce africain

> « Connecter le commerce africain. »

Ce document décrit le domaine **Touma** ajouté au dépôt : ce qui est réellement
implémenté, comment le faire tourner, et ce qui reste à construire.

---

## 1. Positionnement

Touma n'est pas une copie d'Amazon ou d'Alibaba. Le problème visé est plus
précis : une entreprise tchadienne qui veut acheter au Cameroun (ou l'inverse)
n'a aujourd'hui aucun chemin fiable pour **trouver un fournisseur, payer, faire
livrer, suivre et contester**. Touma construit cette couche, corridor par
corridor.

**Corridor pilote : Tchad (TD) ↔ Cameroun (CM).** Aucun pays n'est codé en dur :
tout passe par la table `Country`. Ouvrir le Nigeria ou le Sénégal consiste à
activer une ligne, pas à modifier le code.

Produits prévus, tous représentés dans l'architecture :

| Produit | État | Où |
| --- | --- | --- |
| Touma Marketplace | Fonctionnel | `src/touma/catalog`, `cart`, `orders` |
| Touma Pay | Fonctionnel avec adaptateur de démonstration | `src/touma/payments` |
| Touma Logistics | Fonctionnel avec adaptateur de démonstration | `src/touma/logistics` |
| Touma Verified | Fonctionnel | `src/touma/verification` |
| Touma AI | Fonctionnel (fournisseur heuristique local) | `src/touma/ai` |
| Touma Intelligence | Amorcé (analytique) | `src/touma/admin/analytics.service.ts` |

---

## 2. Décision d'architecture (à lire avant toute reprise)

Le dépôt contenait déjà un **logiciel d'automatisation e-commerce** en
production (Express + Prisma + PWA) : marché, génération de produits, sourcing,
canaux de vente, paiements Stripe/iyzico, assistant IA.

Touma **n'a pas été reconstruit à côté** sous forme d'un monorepo NestJS/Next.js.
Cela aurait produit un second squelette non fonctionnel tout en laissant le
produit existant orphelin. Le choix retenu :

- **même socle** : Express, Prisma, PostgreSQL, TypeScript strict ;
- **domaine isolé** : tout le code Touma vit dans `src/touma/`, monté sur
  `/api/v1`, avec sa propre authentification, ses propres modèles
  (préfixe `Touma`, tables `touma_*`) et ses propres tests ;
- **aucune régression** : le produit historique (`/api/*`) n'est pas modifié.

C'est un **monolithe modulaire** : chaque module (catalogue, paiement,
logistique, confiance, IA) est autonome derrière son service et son routeur. Le
jour où le volume le justifie, un module peut être extrait sans réécriture.

Si le monorepo NestJS/Next.js reste souhaité, la migration se fait module par
module en conservant ces contrats et cette base de données — pas en repartant
d'une page blanche.

---

## 3. Démarrage

```bash
git clone <dépôt> && cd toumai
cp .env.example .env          # renseigner JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
docker compose up -d          # PostgreSQL + Redis (+ API)
npm install
npx prisma migrate deploy     # ou `npx prisma migrate dev` en développement
npm run seed                  # référentiel + comptes + catalogue de démonstration
npm run dev
```

- Interface : <http://localhost:3000/touma/>
- API : <http://localhost:3000/api/v1>
- OpenAPI : <http://localhost:3000/api/v1/openapi.json>
- Sondes : `/health` (vivant) et `/ready` (PostgreSQL, Redis, adaptateurs)

Comptes de démonstration (mot de passe `touma-dev-1234`, **développement
uniquement**) : `admin@touma.dev`, `vendeur.td@touma.dev`,
`vendeur.cm@touma.dev`, `acheteur@touma.dev`.

---

## 4. Modèle de données

Trente modèles préfixés `Touma` (tables `touma_*`), plus la table `Country` et
l'extension du modèle `User` existant (rôle place de marché, pays, statut).

Domaines : pays et adresses · boutiques et vérification · catégories, produits,
images, variantes, stock · panier · commandes et lignes figées · paiements et
événements · commissions et versements · transporteurs, devis, expéditions,
suivi · avis · litiges, messages, preuves · score de risque et signaux de fraude
· favoris · notifications · jetons de rafraîchissement · requêtes et
recommandations d'IA · journal d'audit.

**Règle absolue : tout montant est un `Decimal(18,4)`.** Aucun `Float` financier.
L'utilitaire `src/touma/lib/money.ts` centralise additions, multiplications,
arrondis par devise et **refuse explicitement toute conversion approximative**
entre devises tant qu'aucun fournisseur de taux officiel n'est raccordé.

---

## 5. Ce qui est garanti par les tests

85 tests automatisés s'exécutent contre une vraie base PostgreSQL
(`npm test` — Node ≥ 22, dont le lanceur de tests accepte les motifs glob),
dont le parcours complet de bout en bout :

```
inscription → connexion → boutique → produit → catalogue → panier →
devis transport → commande → paiement → webhook signé → expédition →
suivi → livraison → avis → vérification vendeur → tableau de bord admin
```

Règles vérifiées, entre autres :

- le stock ne devient jamais négatif, même avec deux acheteurs simultanés sur le
  dernier article (décrément conditionnel dans une transaction) ;
- un checkout qui échoue ne décrémente **rien** (atomicité) ;
- le prix d'une commande est relu depuis le catalogue : un prix envoyé par le
  client est ignoré ;
- modifier un produit après la vente ne change jamais la commande passée
  (instantané figé) ;
- un paiement refusé ne fait pas avancer la commande et n'enregistre aucune
  commission ; un webhook rejoué n'est jamais appliqué deux fois ;
- la réutilisation d'un jeton de rafraîchissement révoque toute la famille de
  jetons (vol détecté) ;
- un vendeur ne peut ni modifier la boutique ni les produits d'un autre ; une
  commande tierce répond « introuvable » plutôt que « interdit » (aucune fuite) ;
- le journal d'audit ne contient jamais de secret, de jeton ni de mot de passe ;
- un acheteur ne peut pas présenter un devis de transport national (moins cher)
  pour une expédition transfrontalière, ni un devis établi pour un colis plus
  léger que sa commande ;
- le prestataire de paiement vient de la configuration du serveur : un
  prestataire imposé dans la requête est ignoré, et un code inconnu lève une
  erreur explicite plutôt que de retomber sur l'adaptateur de démonstration.

Un test navigateur optionnel (`npm run test:browser`, nécessite Playwright)
rejoue le même parcours dans Chromium et vérifie l'absence d'erreur console et
de débordement horizontal en 390 px.

---

## 6. Adaptateurs : ce qui est réellement branché

Aucun prestataire externe n'est raccordé à ce stade. Les trois interfaces sont
implémentées et couvertes par des adaptateurs de démonstration **complets**
(signature de webhook, idempotence, anti-rejeu, tarification au poids et au
corridor), qui servent de référence de conformité aux futurs adaptateurs réels.

### Paiement — `PaymentProvider`

```ts
createPayment() · confirmPayment() · refundPayment() · verifyWebhook()
```

Pour raccorder un prestataire réel :

```
DÉPENDANCE EXTERNE
Provider          : à sélectionner parmi les PSP réellement disponibles au
                    Tchad et au Cameroun (mobile money et cartes).
API nécessaire    : création de paiement, confirmation, remboursement,
                    webhook signé.
Variables ENV     : TOUMA_PAYMENT_PROVIDER, plus les clés propres au PSP.
Documentation     : celle du PSP retenu — aucune API n'est inventée ici.
Mock disponible   : oui (`src/touma/payments/providers/mock.provider.ts`).
```

### Logistique — `LogisticsProvider`

```ts
getQuote() · createShipment() · getTracking() · cancelShipment()
```

```
DÉPENDANCE EXTERNE
Provider          : transporteurs réellement présents sur le corridor
                    N'Djamena ↔ Douala/Yaoundé.
API nécessaire    : tarification, création d'étiquette, suivi, annulation.
Variables ENV     : TOUMA_LOGISTICS_PROVIDER, plus les clés du transporteur.
Mock disponible   : oui (`src/touma/logistics/providers/mock.provider.ts`).
```

### IA — `AiProvider`

`generate()`, `classify()`, `recommend()`. Le fournisseur par défaut est une
heuristique locale (sans coût, déterministe) qui s'appuie sur le catalogue réel.
**L'IA ne déclenche jamais d'action financière irréversible** : elle propose, un
humain valide.

---

## 7. Sécurité

- mots de passe : scrypt avec sel (jamais en clair, jamais journalisés) ;
- jeton d'accès court (15 min) + jeton de rafraîchissement **opaque, stocké
  haché**, avec rotation, détection de réutilisation et révocation globale ;
- RBAC (`BUYER` / `SELLER` / `ADMIN`) et contrôle de propriété systématique ;
- anti-IDOR : une ressource d'autrui répond « introuvable » ;
- anti-énumération de comptes : réponse identique que l'e-mail existe ou non ;
- limitation de débit globale et stricte sur l'authentification ;
- validation Zod de toutes les entrées, en-têtes Helmet, CSP sans script en
  ligne ;
- webhooks : signature HMAC sur le corps **brut**, événements rejoués ignorés ;
- idempotence sur le checkout et la création de paiement ;
- journal d'audit sur toute action sensible, sans jamais consigner de secret.

---

## 8. Ce qui reste à faire

1. **Recherche** : la recherche s'appuie sur PostgreSQL (`ILIKE` multi-champs +
   pagination serveur). OpenSearch est provisionné en profil Docker optionnel ;
   l'adaptateur reste à écrire quand le volume du catalogue le justifiera.
2. **Téléversement de fichiers** : les images et documents sont référencés par
   URL. Le stockage S3 est configuré (`S3_*`) mais l'envoi direct depuis
   l'interface reste à implémenter (avec validation de type et de taille).
3. **Notifications multicanal** : le domaine publie des événements et persiste
   les notifications ; les canaux e-mail/SMS/WhatsApp s'enregistrent via
   `registerNotificationChannel` sans toucher au métier.
4. **Versements vendeurs** : le modèle `ToumaSellerPayout` et les commissions
   existent ; le cycle de versement réel dépend du PSP retenu.
5. **Intégrations réelles (V12)** : sélectionner les PSP et transporteurs
   réellement accessibles sur le corridor, puis écrire un adaptateur par
   fournisseur.

---

## 9. Mesure du succès

Les indicateurs suivis dans le tableau de bord d'administration ne sont pas le
nombre de comptes ou de visiteurs, mais :

**10 premières transactions réussies → 100 transactions → premiers vendeurs
récurrents → premiers acheteurs récurrents → premières transactions
transfrontalières.**

Cette dernière métrique (`crossBorderOrders`) est la raison d'être de Touma :
elle est affichée en évidence dès le premier jour.
