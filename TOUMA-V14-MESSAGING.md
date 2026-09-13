# TOUMA V14 — Communication et négociation B2B

Ce document décrit ce qui existe réellement dans le code après la V14. Ce qui
n'est pas fait est dit à la fin, sans détour.

L'audit de l'existant, avec les défauts trouvés et corrigés, est dans
[`TOUMA-V14-AUDIT.md`](./TOUMA-V14-AUDIT.md).

---

## 1. L'idée directrice

Une messagerie de place de marché n'est pas une application de discussion.
Quand un fournisseur camerounais ouvre un fil, il doit comprendre en trois
secondes :

> Qui me contacte ? Quelle entreprise ? Quel produit ? Quelle quantité ? Quelle
> destination ? Quel prix est sur la table ? Que dois-je faire maintenant ?

Toute l'architecture découle de cette question. Une conversation porte son
**contexte commercial** (boutique, appel d'offres, offre, commande) ; une offre
apparaît dans le fil comme une **carte lisible** et non comme un paragraphe ;
et le bandeau de négociation affiche en permanence **la prochaine action
possible**, avec son échéance.

Le parcours complet :

```
acheteur → contact fournisseur → conversation → appel d'offres → offre
        → contre-offre → négociation → accord → commande → paiement
```

---

## 2. Modèle de données

Tout vit dans le schéma Prisma existant, préfixé `Touma`.

### Conversation

| Champ | Rôle |
| --- | --- |
| `kind` | `BUYER_SELLER` (direct), `RFQ`, `QUOTE`, `ORDER`, `SUPPORT` |
| `status` | `ACTIVE`, `ARCHIVED`, `CLOSED`, `BLOCKED` |
| `storeId`, `rfqId`, `quoteId`, `orderId` | le contexte, en relations réelles |
| `createdById` | qui a ouvert le fil (anti-spam, audit) |
| `lastMessageAt` | tri de la boîte de réception (indexé) |

Un fil est identifié par **son contexte *et* ses participants**. C'est ce qui
empêche deux acheteurs discutant avec la même boutique de tomber dans le même
fil — le défaut que les tests V14 ont fait apparaître.

### Participant

`role` (`BUYER` | `SELLER` | `ADMIN` | `SUPPORT`), `businessProfileId`,
`lastReadAt`, `mutedAt`, `archivedAt`. Archiver et couper les alertes sont des
gestes **personnels** : ils n'affectent jamais ce que voit l'autre partie.

### Message

`type` (`TEXT`, `SYSTEM`, `OFFER`, `COUNTER_OFFER`, `QUOTE`, `ORDER_UPDATE`,
`ATTACHMENT`), `metadata` (contexte structuré de la carte), `replyToId`
(réponse citée), `negotiationMessageId` (l'offre que porte le message),
`editedAt`, `deletedAt`.

`authorId` est **nullable** : un message système n'émane de personne. Aucun
utilisateur ne peut en produire — le type envoyé par le client est ignoré.

### Autour

`ToumaMessageAttachment` (clé de stockage, empreinte SHA-256),
`ToumaMessageReport`, `ToumaRiskFlag`, `ToumaUserBlock`, `ToumaSavedReply`,
`ToumaNotificationPreference`.

### Index ajoutés

`Message(conversationId, createdAt)`, `Message(authorId, createdAt)`,
`Conversation(rfqId | quoteId | orderId)`, `ConversationParticipant(userId,
lastReadAt)`, `NegotiationMessage(quoteId, createdAt)`,
`Notification(userId, readAt)`.

---

## 3. Négociation

### Machine d'état

Déclarée une seule fois, dans `src/touma/b2b/negotiation.ts` :

```
SUBMITTED ─┬─▶ COUNTERED ─┬─▶ ACCEPTED   (terminal)
           │              ├─▶ REJECTED   (terminal)
           │              ├─▶ EXPIRED    (terminal)
           │              ├─▶ WITHDRAWN  (terminal)
           │              └─▶ COUNTERED  (va-et-vient)
           └─▶ ACCEPTED | REJECTED | EXPIRED | WITHDRAWN
```

Une transition non prévue est un **409**, pas un comportement indéfini.
`ACCEPTED → COUNTERED` est impossible.

### Le serveur calcule, le client propose

Le client envoie des **lignes** (désignation, quantité, unité, prix unitaire)
et des frais de livraison. `computeOffer()` — fonction pure — produit les
totaux. C'est la **même fonction** qui alimente l'aperçu et l'écriture en base :
il ne peut donc pas y avoir d'écart entre le montant annoncé et le montant
enregistré. Un champ `total` envoyé par un client est purement ignoré.

### Qui peut quoi

| Geste | Acheteur | Fournisseur |
| --- | --- | --- |
| Contre-proposer | oui (reste une **demande**) | oui (**révise** son offre) |
| Entériner la proposition d'en face | — | oui (`/apply`) |
| Accepter et créer la commande | oui (avec son adresse) | — |
| Refuser | oui (clôt l'offre) | oui (décline la demande, l'offre survit) |
| Retirer l'offre | — | oui, tant qu'elle n'est pas acceptée |

Une révision du fournisseur **remplace ses lignes** en même temps que ses
totaux. C'est la correction du défaut V13 : le total changeait seul et la
commande héritait d'un sous-total qui ne correspondait plus à ses lignes.

### Expiration

`expireStaleQuotes()` passe en `EXPIRED` toute offre dont la validité est
dépassée. Idempotent, appelé à la lecture d'une négociation, exposable en tâche
planifiée. Le navigateur n'a jamais le pouvoir de décider qu'une offre a
expiré : il ne fait que l'afficher.

### Acceptation

Transactionnelle, avec **prise conditionnelle** (`updateMany … where status IN
(SUBMITTED, COUNTERED)`) : deux acceptations simultanées ne produisent jamais
deux commandes. La commission est calculée avec `applyRate` et
`env.touma.commissionRate` — le même chemin que le checkout.

---

## 4. Pièces jointes

Le format V13 (URL, type et taille **déclarés par le client**) est refusé
explicitement, avec un message qui indique la marche à suivre. Il n'était
vérifiable en rien.

Le nouveau chemin :

1. le fichier part en **corps brut** (`application/octet-stream`), le nom
   d'origine dans `x-file-name` (encodé : un en-tête HTTP ne transporte pas les
   accents) ;
2. le serveur **mesure** le contenu et **reconnaît le type à ses octets**
   (`%PDF`, `FF D8 FF`, `89 50 4E 47`, `RIFF…WEBP`, ZIP + nom `.xlsx`, texte
   simple pour `.csv`) ;
3. tout exécutable est refusé (`MZ`, ELF, Mach-O, shebang), de même qu'un
   contenu HTML ou SVG déguisé en CSV ;
4. le fichier est empreinté (SHA-256) et rangé sous une **clé non devinable**,
   hors du dossier servi statiquement ;
5. il n'est rendu que par **URL signée** (HMAC, quelques minutes) ou à un
   participant authentifié, toujours en `Content-Disposition: attachment` avec
   `X-Content-Type-Options: nosniff`, et jamais avec un type actif.

Formats : PDF, JPEG, PNG, WebP, XLSX, CSV. Taille par défaut : 10 Mo.

Le stockage est derrière l'interface `AttachmentStorage` (`storage.ts`). Deux
implémentations sont livrées :

- **disque local** (`LocalPrivateStorage`), par défaut, hors du dossier servi
  statiquement, fichiers en `0600` ;
- **service objet compatible S3** (`s3-storage.ts`) — MinIO, Cloudflare R2,
  Scaleway, Wasabi, Backblaze B2, AWS S3 — actif dès que `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY` et `S3_SECRET_KEY` sont renseignés.

La signature AWS V4 est calculée dans le fichier, sans SDK : quelques HMAC
suffisent, et la dérivation de la clé est confrontée au vecteur d'exemple publié
par AWS dans les tests unitaires.

Trois points méritent d'être dits, parce qu'ils sont faciles à rater :

1. **Aucune URL présignée S3 n'est remise au navigateur.** Le serveur lit
   l'objet, vérifie d'abord que le demandeur participe au fil, puis sert le
   contenu derrière sa propre URL signée. Une URL présignée court-circuiterait
   ce contrôle : recopiée, elle ouvrirait la pièce jointe à n'importe qui
   pendant toute sa durée de validité.
2. **Aucun objet n'est écrit en accès public.** La configuration du bucket
   (accès bloqué, chiffrement au repos) relève de l'exploitant ; le code ne la
   contredit jamais.
3. **Une configuration S3 incomplète fait échouer le démarrage.** Retomber
   silencieusement sur le disque local donnerait un service qui a l'air de
   marcher, avec des fichiers là où personne ne les cherchera.

La clé d'un objet est validée au même endroit pour les deux adaptateurs
(`assertStorageKey`) : ni chemin absolu, ni remontée, ni segment vide — un
chemin n'a pas le même effet sur un disque et sur un service objet, et aucun des
deux n'est acceptable.

---

## 5. Sécurité

- **Participation d'abord.** Aucune lecture, aucune écriture hors de ses fils.
  Une conversation, un message ou une pièce jointe d'autrui répond
  « introuvable », jamais « interdit ».
- **L'administration est tracée.** Un administrateur peut lire un fil pour
  traiter un signalement ; chaque accès écrit une ligne d'audit, et il ne peut
  pas y écrire comme un participant commercial.
- **Immuabilité de l'argent.** Offres, contre-offres, accords et messages
  système ne se suppriment pas — pour personne, pas même leur auteur.
- **Modification bornée.** 15 minutes par défaut, jamais sur un message
  financier ou système, `editedAt` conservé.
- **Suppression douce.** Le fil garde la place du message, avec la mention
  « Message supprimé ».
- **Confidentialité.** Ni e-mail, ni téléphone, ni clé de stockage, ni jeton
  dans les réponses de l'API. L'audit porte le motif d'un signalement, jamais le
  contenu du message.
- **Limitation par personne** (mémoire du processus) : 20 messages/minute,
  30 conversations/heure, 10 fichiers/minute, 10 propositions/minute.
- **Idempotence** : ouvrir deux fois la même conversation ne crée qu'un fil ;
  solliciter deux fois un fournisseur ne le prévient qu'une fois.

### Détection de risque

On **signale, on ne supprime pas**. Un message qui mentionne WhatsApp n'est pas
une fraude : c'est un outil de travail quotidien en Afrique centrale. Ce qui
compte, c'est l'invitation à *payer hors de TOUMA*, là où l'acheteur perd toute
protection.

Au-delà d'un seuil, un rappel de sécurité est publié dans le fil — visible des
deux parties, sans rien bloquer. Le signal remonte à l'administration avec un
**extrait borné**, jamais le message entier. Aucun score ne suspend un compte
ni n'abaisse une réputation : l'humain tranche.

---

## 6. Temps réel

Le prompt demandait une passerelle WebSocket. Le choix retenu est un **flux
d'événements serveur (SSE)** :

- il traverse proxys, pare-feu d'entreprise et réseaux mobiles qui coupent
  souvent WebSocket ;
- il n'ajoute **aucune dépendance** ;
- le navigateur se reconnecte seul ;
- l'`EventSource` ne portant pas d'en-tête d'autorisation, l'accès passe par un
  **ticket signé** valable une minute, qui ne donne accès qu'à ses propres
  événements.

Événements : `message.created`, `message.updated`, `message.deleted`,
`message.read`, `offer.created`, `offer.accepted`, `offer.rejected`,
`conversation.updated`.

**Le flux est facultatif.** Tout ce qu'il fait, un rechargement le fait aussi.
S'il tombe, l'application reste entièrement utilisable : REST est la source de
vérité. Le bus est en mémoire — sur plusieurs instances, `events.ts` est le
seul fichier à remplacer par un bus partagé.

La **présence** n'est affichée que si elle est réelle (un flux ouvert). Aucune
présence n'est inventée ni stockée.

---

## 7. API

Tous les chemins sont documentés dans `/api/v1/openapi.json` (125 chemins).

**Conversations** — `GET/POST /conversations`, `GET /conversations/unread-count`,
`GET/PATCH /conversations/:id`, `POST /conversations/:id/read`,
`GET/POST /conversations/:id/messages`, `POST /conversations/:id/attachments`.

**Messages** — `GET /messages/search`, `POST /messages/:id/reply`,
`PATCH /messages/:id`, `DELETE /messages/:id`, `POST /messages/:id/report`.

**Pièces jointes** — `GET /attachments/:id` (URL signée ou participant).

**Messagerie** — `POST /messaging/stream-ticket`, `GET /messaging/stream`,
`GET/POST /messaging/templates`, `PATCH/DELETE /messaging/templates/:id`,
`GET/PUT /messaging/preferences`, `GET/POST /messaging/blocks`,
`DELETE /messaging/blocks/:userId`, et pour l'administration
`GET /messaging/reports`, `POST /messaging/reports/:id/resolve`,
`GET /messaging/risk-flags`, `POST /messaging/risk-flags/:id/resolve`.

**Négociation** — `GET /negotiations/:id`, `POST /negotiations/:id/counter`
(alias `/offers`), `/accept`, `/apply`, `/reject`, `/withdraw`.

Les endpoints V13 (`/quotes/:id/messages`, `/accept`, `/reject`) continuent de
fonctionner ; ils délèguent au même moteur.

---

## 8. Interface

| Page | Chemin |
| --- | --- |
| Messagerie acheteur | `/touma/messages` |
| Messagerie Business | `/touma/business/messages` |
| Messagerie vendeur | `/touma/vendeur/messages` |
| Fil de discussion | `…/messages/:id` |
| Négociation | `/touma/negociations/:id` (et déclinaisons business / vendeur) |
| Préférences et réponses types | `/touma/messages/reglages` |
| Modération | `/touma/admin/moderation` |

Sur grand écran : liste à gauche (32 %), conversation à droite. Sur mobile : la
conversation occupe tout l'écran, la liste est une page à part, le champ de
saisie reste collé au bas. Testé sans débordement horizontal à 360, 390, 430,
768, 900, 1024, 1280 et 1440 px.

Le champ de saisie propose des **raccourcis commerciaux** (prix, quantité
minimale, délai, transport, remise au volume) et les **réponses enregistrées**
du compte. Entrée envoie, Maj+Entrée va à la ligne.

---

## 9. Notifications

Types ajoutés : `MESSAGE_RECEIVED`, `MESSAGE_REPLY`, `ATTACHMENT_RECEIVED`,
`OFFER_RECEIVED`, `COUNTER_OFFER_RECEIVED`, `OFFER_ACCEPTED`, `OFFER_REJECTED`,
`NEGOTIATION_EXPIRING`, `NEGOTIATION_EXPIRED`, `RFQ_UPDATE`, `ORDER_UPDATE`.

Cinq catégories de préférence : messages, négociation, appels d'offres,
commandes, nouveautés. Canaux : in-app (natif) et e-mail (derrière
`NotificationChannel`). Tant qu'aucun expéditeur n'est configuré, l'interface
**le dit** au lieu de proposer une case qui ne ferait rien.

---

## 10. Tests

- **51 tests unitaires** : détection de risque (y compris ce qu'elle ne doit
  *pas* signaler), reconnaissance de format et refus d'exécutable, URL signées,
  calcul d'offre, machine d'état, limitation de débit.
- **227 tests d'intégration** contre une vraie base PostgreSQL, dont
  `messaging-v14` (31) et `negotiation` (14) : réponses citées, fenêtre de
  modification, suppression douce, curseur, recherche cloisonnée, pièces
  jointes et anti-IDOR, blocage, signalement, préférences, tickets de flux.
- **33 tests de bout en bout**, dont le parcours B2B complet.
- **49 étapes navigateur** (Chromium), dont huit consacrées à la messagerie et
  à la négociation, à huit largeurs d'écran, sans erreur console.

Total : **311 tests** automatisés + 49 étapes navigateur.

---

## 11. Ce qui n'est PAS fait

- **Aucun canal e-mail réel.** L'interface `NotificationChannel` attend une
  implémentation ; aucune n'est livrée, et l'interface l'annonce.
- **Stockage S3 : écrit, non éprouvé contre un service réel.** L'adaptateur est
  livré et couvert par des tests unitaires (signature, adressage, erreurs), mais
  aucun bucket n'a été raccordé ici : la première mise en service demande une
  vérification de bout en bout avec les identifiants de l'exploitant.
- **Bus temps réel partagé.** Le flux fonctionne sur un processus. Plusieurs
  instances demanderaient Redis pub/sub dans `events.ts`.
- **OpenSearch.** La recherche de messages s'appuie sur PostgreSQL
  (`contains`, insensible à la casse). Au volume actuel, un index externe
  n'apporterait rien.
- **Indicateur de saisie (« en train d'écrire »).** Les événements sont
  déclarés, l'interface ne les émet pas encore. Rien n'est stocké en base, et
  rien ne le sera.
- **Messages vocaux, appels, traduction automatique, assistant IA de
  négociation, synchronisation WhatsApp ou e-mail, CRM.** Hors périmètre V14,
  volontairement : l'architecture ne les empêche pas, elle ne les anticipe pas
  non plus.
