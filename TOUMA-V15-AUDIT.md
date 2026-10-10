# TOUMA V15 — audit préalable

Fait avant d'écrire une ligne, et en appliquant la consigne du §1 : ne jamais
supposer qu'une fonctionnalité annoncée existe réellement. Chaque ligne ci-dessous
a été vérifiée dans le code, pas dans la documentation.

Le résultat tient en une phrase : **le moteur multi-vendeurs demandé par la V15
existe déjà en grande partie** — et trois défauts réels s'y cachent, dont deux
qui coûtent de l'argent.

---

## 1. Ce qui existe déjà, et qui répond au cahier des charges

### L'architecture Order / SellerOrder (§2, §3, §4, §6)

Elle est là, sous d'autres noms :

| V15 demande | Le dépôt a | Fichier |
| --- | --- | --- |
| `Order` (commande globale du buyer) | `ToumaOrderGroup` | `prisma/schema.prisma:1700` |
| `SellerOrder` (sous-commande d'un vendeur) | `ToumaOrder` | `prisma/schema.prisma:1122` |
| `OrderItem` rattaché au SellerOrder | `ToumaOrderItem.orderId` | `prisma/schema.prisma:1204` |

Un panier multi-vendeurs produit **un groupe, un paiement, et autant de
sous-commandes que de boutiques**. Chaque sous-commande porte son sous-total, sa
livraison, sa commission, sa part de remise et son statut.

### Le snapshot de commande (§5)

`ToumaOrderItem` fige `titleSnapshot`, `skuSnapshot`, `variantSnapshot`,
`imageSnapshot`, `unitPrice`, `quantity`, `lineTotal`, `currency`. Modifier le
produit après la vente ne change pas la commande — c'est vérifié par un test
d'intégration.

**Écart** : pas de champ `metadata` (§5 le demande, nullable).

### Le prix calculé côté serveur (§9)

`checkout.service.ts` ne lit aucun total du client : il recharge produits,
variantes, promotions et devis de transport, et recalcule. Un devis de transport
présenté par le client est même recontrôlé sur le trajet **et le poids réels**
(`checkout.service.ts:117`) — sans quoi un acheteur pourrait présenter un tarif
national pour une expédition transfrontalière et sous-payer le transport.

### La quantité minimale B2B (§11) — **déjà appliquée**

Contrairement à ce qu'on pourrait croire, le MOQ n'est pas décoratif :

- refusé à l'ajout au panier — `cart.service.ts:147` ;
- signalé dans le panier — `cart.service.ts:56` (`BELOW_MIN_ORDER_QTY`) ;
- refusé au checkout — `checkout.service.ts:103`.

Rien à faire ici.

### Expédition par vendeur et suivi (§13, §14, §15)

`ToumaShipment.orderId` pointe la **sous-commande**, pas le groupe : une commande
multi-vendeurs a donc naturellement plusieurs expéditions. `ToumaTrackingEvent`
existe avec horodatage, libellé et lieu.

**Écarts** : pas de ville d'origine/destination ni de date de livraison estimée
sur l'expédition ; les statuts de suivi réutilisent `ShipmentStatus` et ne
couvrent ni le passage en douane, ni l'arrivée en hub, ni la sortie en livraison,
ni l'incident.

### Retours, remboursements, litiges (§24–§28)

`ToumaReturnRequest`, `ToumaReturnItem`, `ToumaRefund`, `ToumaDispute` existent.
Le remboursement partiel est géré et **borné par deux plafonds simultanés** — le
solde de la commande et le montant réellement encaissé (`refund.service.ts`). La
commission est contre-passée au prorata.

**Écarts** : `ReturnReason` n'a ni `QUALITY`, ni `SIZE`, ni `QUANTITY_SHORTAGE`
(§25).

### Adresses africaines (§36, §37) — **complet**

`ToumaAddress` porte déjà `region`, `district`, `landmark`, `instructions`,
`latitude`, `longitude`, et `postalCode` est **facultatif**. Les instructions de
livraison ne sont jamais exposées publiquement.

### Points relais (§38) et multi-pays (§39, §40)

`ToumaPickupPoint` existe et est relié à la commande via `deliveryMethod` +
`pickupPointId`. Les pays viennent du modèle `Country` ; aucune règle n'est codée
en dur pour le Tchad ou le Cameroun. `lib/money.ts` **refuse toute conversion
entre devises** tant qu'aucun taux officiel n'est raccordé, plutôt que d'en
inventer un.

### Commission et payout (§21, §22, §23)

`ToumaCommission` est calculée **par sous-commande**, côté serveur. Un vendeur ne
peut pas déclencher son propre versement : `ToumaSellerPayout` est créé par
l'administration et agrège des commissions.

**Écart** : `PayoutStatus` n'a ni `ELIGIBLE` ni `HELD` (§22), donc aucun état ne
distingue « payable » de « retenu pour litige ».

---

## 2. Les trois défauts réels

### ① Le stock réservé ne se libère jamais — **coûte des ventes**

`checkout.service.ts:331` décrémente le stock et incrémente `reserved` au moment
du checkout, dans une transaction, avec une mise à jour conditionnelle qui
empêche la survente. Très bien.

Mais la réservation n'a **aucune durée de vie**. Si l'acheteur ne paie jamais —
il ferme l'onglet, son Mobile Money échoue, il change d'avis — la commande reste
`PENDING` et le stock reste sorti du catalogue **indéfiniment**. Aucun balayage
ne les libère : la recherche `expireStale|abandon|stale` dans `src/touma/orders/`
et `src/touma/payments/` ne renvoie rien.

Conséquence concrète : un vendeur qui a dix sacs de cacao en voit zéro à la vente
parce que dix acheteurs ont ouvert un checkout sans payer. C'est exactement ce
que le §10 demande de corriger, avec une durée configurable.

### ② Le statut du groupe n'est jamais recalculé — **information fausse**

`OrderGroupStatus` déclare `PARTIALLY_FULFILLED`. **Rien ne l'écrit jamais.** Le
groupe passe à `PAID` au paiement, à `REFUNDED` si tout est remboursé
(`refund.service.ts:205`), et ne bouge plus.

Conséquence : sur une commande à trois vendeurs dont l'un a livré et les deux
autres préparent, la commande globale affiche encore « payée ». L'acheteur ne
peut pas savoir où il en est, et le §41 demande précisément les états
intermédiaires `PARTIALLY_SHIPPED` et `PARTIALLY_DELIVERED`.

### ③ Il manque une étape avant l'expédition — **le vendeur ment sans le vouloir**

La machine d'état va de `PROCESSING` directement à `SHIPPED`
(`order.service.ts:20`). Il n'y a pas de `READY_TO_SHIP`.

Un vendeur qui a fini de préparer son colis, mais dont le transporteur passe
demain, n'a que deux choix : rester en « préparation » (l'acheteur croit que rien
n'avance) ou déclarer « expédié » (ce qui est faux, et fait courir le délai de
livraison). Le §4 et le §16 demandent cet état.

---

## 3. Écarts secondaires, listés sans dramatisation

| § | Attendu | État |
| --- | --- | --- |
| §3 | `sourceType`, `rfqId`, `quoteId` sur la commande globale | Absents — une commande née d'un appel d'offres est indiscernable d'une commande née d'un panier |
| §5 | `metadata` sur la ligne de commande | Absent |
| §12 | Paliers de prix B2B (10 / 50 / 100 / 500) | **Inexistants** — un prix, un seul, quelle que soit la quantité |
| §14 | Ville d'origine/destination, date de livraison estimée | Absents (les pays sont là) |
| §15 | `PICKED_UP`, `ARRIVED_AT_HUB`, `CUSTOMS`, `OUT_FOR_DELIVERY`, `EXCEPTION` | Absents — le passage en douane est pourtant le point de friction du corridor |
| §17 | Endpoints vendeurs nommés (`confirm`, `process`, `ready-to-ship`, `ship`) | Un seul `PATCH /orders/:id/status` générique |
| §18 | `POST /orders/:id/confirm-delivery`, `GET /orders/:id/tracking` | Absents (la confirmation passe par le `PATCH` générique) |
| §22 | `ELIGIBLE`, `HELD` sur le versement | Absents |
| §25 | `QUALITY`, `SIZE`, `QUANTITY_SHORTAGE` | Absents |
| §32/§33 | Centre de commandes d'administration + recherche | Partiels |

---

## 4. Ce que la V15 va faire

Par ordre de valeur, pas par ordre du cahier des charges.

1. **Libérer le stock réservé** après un délai configurable, par un balayage
   idempotent et sans course — le défaut qui coûte des ventes aujourd'hui.
2. **Recalculer le statut de la commande globale** à partir de ses
   sous-commandes, avec les états partiels réellement écrits.
3. **Ajouter `READY_TO_SHIP`** à la machine d'état, et les endpoints nommés qui
   vont avec.
4. **Paliers de prix B2B**, résolus par le serveur, tracés dans la ligne de
   commande.
5. **Origine de la commande** (`sourceType`, `rfqId`, `quoteId`) et
   **statuts de suivi** couvrant la douane et l'incident.

Ce qui n'est pas fait est écrit à la fin de `TOUMA-V15-FULFILMENT.md`, avec la
raison. Les paiements fractionnés, les acomptes B2B et les versements réels
restent des décisions d'exploitation, pas des oublis : le §20 demande d'ailleurs
explicitement de **préparer** l'architecture sans les implémenter prématurément.
