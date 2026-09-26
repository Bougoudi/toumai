# TOUMA V14 — Audit de l'existant (V13)

Audit réalisé avant toute écriture de code, sur le dépôt réel et non sur la
documentation. Chaque constat ci-dessous a été vérifié dans le code source.

## 0. Écart entre le prompt et le dépôt

Le prompt V14 décrit une architecture Next.js + NestJS. **Elle n'existe pas.**
Le dépôt est un monolithe modulaire Express + Prisma, avec un frontend en
modules ES sans dépendance (compatible avec la CSP du serveur). Ce choix est
documenté dans `docs/touma-marketplace.md` : le dépôt contenait déjà un produit
en service, et fabriquer un second squelette à côté aurait laissé deux
applications à moitié faites.

V14 est donc implémentée sur le socle réel :

| Prompt | Réalité du dépôt |
| --- | --- |
| NestJS module + service + controller | `src/touma/<domaine>/<domaine>.{routes,service,schema}.ts` |
| Next.js pages | vues ES chargées à la demande dans `public/touma/` |
| WebSocket Gateway NestJS | flux d'événements serveur (SSE) + REST en repli |
| BullMQ | balayage d'expiration déclenché à la lecture, sans dépendance à Redis |

## 1. Ce qui existe réellement en V13

**Messagerie** (`src/touma/messaging/`, 213 lignes de service) :
`ToumaConversation` + `ToumaConversationParticipant` + `ToumaMessage` +
`ToumaMessageAttachment`. Ouverture d'un fil avec une boutique, envoi de
message, liste, compteur de non-lus, contrôle de participation.

**Négociation** (`src/touma/b2b/`) : `ToumaRfq`, `ToumaRfqItem`, `ToumaQuote`,
`ToumaQuoteItem`, `ToumaNegotiationMessage`, `ToumaRfqInvitation`. Création
d'appel d'offres, réponse fournisseur, message et contre-proposition,
acceptation qui crée une vraie commande.

**Ce que la documentation laissait croire mais qui n'existe pas :**

- aucune conversation n'est créée pour une RFQ, un devis ou une commande — le
  champ `ToumaConversation.rfqId` existe mais **sans relation, sans index, et
  n'est jamais écrit** ;
- `ConversationKind` déclare `RFQ` : **aucun code ne produit cette valeur** ;
- `QuoteStatus.EXPIRED` n'est **jamais écrit** : l'expiration est calculée à la
  lecture, le statut reste `SUBMITTED` indéfiniment ;
- il n'y a ni réponse à un message, ni édition, ni suppression, ni type de
  message, ni signalement, ni blocage, ni recherche.

## 2. Défauts bloquants trouvés (corrigés en V14)

### 2.1 Une contre-proposition du vendeur casse la cohérence financière

`b2b.service.ts` → `negotiate()` : quand le **vendeur** contre-propose un
total, le service écrit

```ts
total: new Prisma.Decimal(input.proposedTotal),
itemsTotal: new Prisma.Decimal(input.proposedTotal).minus(quote.shippingTotal)
```

sans toucher aux `ToumaQuoteItem`. La somme des lignes ne vaut alors plus
`itemsTotal`. Or `acceptQuote()` crée la commande avec `subtotal = itemsTotal`
**et** des lignes recopiées depuis `quote.items` : la commande produite a un
sous-total qui ne correspond pas à la somme de ses propres lignes. C'est une
incohérence comptable qui se propage jusqu'à la facture.

Aggravant : `proposedTotal` n'est jamais comparé à `shippingTotal`. Un total
proposé inférieur aux frais de port donne un `itemsTotal` **négatif**.

### 2.2 Double acceptation possible sous concurrence

`acceptQuote()` lit l'offre, vérifie `status`, puis ouvre une transaction.
Entre la lecture et l'écriture, une seconde requête peut passer la même
vérification : deux commandes pour une seule offre. Le contrôle doit être une
**mise à jour conditionnelle** à l'intérieur de la transaction.

### 2.3 Le compteur de non-lus ne passe pas à l'échelle

`unreadCount()` charge **toutes** les participations de l'utilisateur, chacune
avec son dernier message, puis filtre en JavaScript. Sur un compte à 500 fils,
c'est 500 sous-requêtes à chaque chargement de page. Le prompt l'interdit
explicitement (§22).

### 2.4 Les pièces jointes ne sont pas contrôlées

Le client envoie `url`, `mimeType` et `sizeBytes`. Le service valide… ce que le
client a déclaré. N'importe quel appelant peut annoncer `image/jpeg` pour un
fichier arbitraire, ou une taille de 10 octets pour un fichier de 2 Go, ou une
URL vers un site tiers. Aucun stockage, aucune empreinte, aucune URL signée.

### 2.5 Un administrateur lit tout sans trace

`requireParticipant()` accorde l'accès si `user.role === 'ADMIN'`, sans écrire
la moindre ligne d'audit. Le prompt (§37) exige que toute intervention
administrateur soit auditable.

### 2.6 Les notifications de message mentent sur leur type

Un nouveau message produit une notification de type `ORDER_STATUS_CHANGED`. Le
type n'existait pas ; celui-là a été réutilisé faute de mieux. Les
préférences de notification sont donc impossibles à exprimer.

### 2.7 Commission calculée hors configuration

`acceptQuote()` lit `process.env.TOUMA_COMMISSION_RATE` directement, alors que
le checkout utilise `env.touma.commissionRate` et l'arrondi de `applyRate`. Deux
chemins de commande, deux calculs de commission.

### 2.8 Index manquants

`ToumaMessage` n'a qu'un index sur `conversationId` (la lecture trie par
`createdAt`), `ToumaNegotiationMessage` qu'un index sur `quoteId`,
`ToumaNotification` qu'un index sur `userId` alors que toutes les requêtes
filtrent sur `readAt`.

### 2.9 Aucune limite de débit spécifique

Seul le limiteur global d'API s'applique. Rien n'empêche d'inonder un fil ou
d'ouvrir cent conversations par minute.

## 3. Ce qui va bien et qui est conservé

- le contrôle d'accès par **participation** est correct : une conversation
  d'autrui répond « introuvable », jamais « interdit » ;
- un fournisseur ne voit jamais les offres concurrentes (`getRfq` filtre par
  `sellerId`) ;
- l'acceptation d'une offre crée une vraie commande payable, avec instantanés
  figés — c'est le bon modèle, il est conservé tel quel ;
- les montants sont des `Decimal(18,4)` partout, et `assertSameCurrency` refuse
  toute conversion approximative.

## 4. Décisions d'architecture V14

1. **Une seule messagerie.** Les négociations ne vivent plus dans un fil
   parallèle : une offre commerciale devient un **message typé** dans la
   conversation, adossé à son `ToumaNegotiationMessage` (qui reste la source de
   vérité financière et auditable). Il n'y a plus deux histoires à raconter.
2. **Le serveur calcule les totaux.** Le frontend n'envoie jamais un total ; il
   envoie quantité, prix unitaire, transport, et lit ce que le serveur a
   calculé.
3. **Machine d'état explicite.** Les transitions de négociation sont déclarées
   dans une table unique et vérifiées à chaque écriture ; une transition
   invalide est un 409, pas un comportement indéfini.
4. **Expiration sans dépendance.** L'expiration est appliquée par un balayage
   idempotent, déclenché à la lecture et exposé en tâche administrable — pas
   par le frontend, et sans exiger Redis, qui reste optionnel dans ce dépôt.
5. **Temps réel en supplément, jamais en prérequis.** Les événements sont
   diffusés par un flux serveur (SSE, qui traverse les proxys et ne demande
   aucune dépendance) ; l'application reste entièrement fonctionnelle si le
   flux est coupé.
6. **Les fichiers ne sont plus des URL déclarées.** Le contenu est reçu,
   mesuré, empreinté, stocké sous une clé non devinable, et servi uniquement
   aux participants, via une URL signée à durée courte.
