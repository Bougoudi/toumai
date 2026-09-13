# TOUMA V15 — exécution des commandes multi-vendeurs

Ce document décrit ce qui a été construit, et surtout **pourquoi**. L'audit
préalable est dans `TOUMA-V15-AUDIT.md` : il explique ce qui existait déjà, et
c'était l'essentiel.

## La chaîne, telle qu'elle tourne

```
Panier (plusieurs boutiques)
        │
     checkout ──────────────────────────────► un seul paiement
        │
        ├── Commande globale  (ToumaOrderGroup)
        │      statut DÉDUIT de ses sous-commandes
        │
        ├── Sous-commande vendeur A (ToumaOrder)
        │     ├── lignes figées (prix, palier appliqué)
        │     ├── expédition + suivi
        │     └── commission
        │
        └── Sous-commande vendeur B (ToumaOrder)
              └── …
```

La commande globale n'a jamais son propre statut « décidé » quelque part : il est
**calculé** à partir de ses sous-commandes, à chaque changement, dans la même
transaction.

---

## 1. La réservation de stock expire

**Le défaut.** Le checkout sort les articles du catalogue immédiatement — c'est
ce qui empêche deux acheteurs de se disputer le dernier sac. Mais la réservation
n'avait aucune durée de vie. Un acheteur qui ferme l'onglet, dont le Mobile Money
échoue ou qui change d'avis laissait le stock sorti du catalogue **pour
toujours**. Un vendeur avec dix sacs de cacao pouvait n'en voir aucun à la vente
parce que dix personnes avaient ouvert un checkout sans payer.

**La correction** (`orders/reservation.ts`) tient en trois règles.

**On ne touche jamais une commande dont le paiement est engagé.** C'est le point
délicat, et c'est celui qui aurait coûté le plus cher s'il avait été manqué :
entre le moment où l'acheteur part chez son opérateur et celui où le webhook
revient, la commande est encore « en attente ». L'annuler là, c'est encaisser une
commande annulée. Un groupe portant un paiement en cours ou réussi est donc
intouché, quel que soit son âge.

**La prise est atomique.** L'annulation passe par une mise à jour conditionnée au
statut : si un paiement arrive dans le même instant, la condition ne s'applique
pas et le balayage passe son chemin. Rejouer le balayage ne fait rien de plus.

**Le stock revient exactement comme il est parti.** `quantity` remonte,
`reserved` redescend — sans quoi le compteur de réservations dériverait à chaque
annulation, silencieusement.

Le délai est configurable (`TOUMA_ORDER_RESERVATION_MINUTES`, 15 minutes par
défaut). Le balayage s'exécute sur le chemin du checkout, au plus une fois par
intervalle : le stock libéré redevient visible pour l'acheteur suivant sans
attendre une tâche planifiée, et sans lancer une requête d'inventaire à chaque
validation de panier.

## 2. Le statut de la commande globale est calculé

**Le défaut.** `PARTIALLY_FULFILLED` existait dans le schéma et **rien ne
l'écrivait jamais**. Une commande à trois vendeurs dont l'un avait livré et les
deux autres préparaient affichait encore « payée ».

**La correction** (`orders/group-status.ts`) : le groupe avance au rythme du plus
lent, et **nomme l'écart** quand ses vendeurs ne sont pas au même endroit —
`PARTIALLY_SHIPPED`, `PARTIALLY_DELIVERED`.

Trois décisions valent d'être dites :

- **« Expédié » et « en transit » comptent pour une seule étape.** Du point de vue
  de l'acheteur, le colis est parti ; afficher « partiellement expédiée » parce
  qu'un transporteur a scanné avant l'autre serait du bruit.
- **Un vendeur qui annule n'est pas un vendeur en retard.** Si deux boutiques sur
  trois livrent et que la troisième annule, la commande est livrée. Elle n'est
  annulée que lorsqu'il ne reste plus rien.
- **Un litige n'efface pas l'avancement.** Il se lit ailleurs ; il ne remet pas la
  logistique à zéro.

Le calcul est une fonction pure, testée sans base de données.

## 3. L'étape « prêt à expédier »

La machine d'état allait de `PROCESSING` à `SHIPPED`. Un vendeur qui avait fini
son colis mais dont le transporteur passait le lendemain n'avait que deux choix :
rester en « préparation » (l'acheteur croit que rien n'avance) ou déclarer
« expédié » (c'est faux, et ça fait courir le délai de livraison).

`READY_TO_SHIP` s'intercale — et la machine l'accepte depuis `PAID` comme depuis
`PROCESSING`. C'est le parcours navigateur qui l'a imposé : le bouton s'affichait
sur une commande payée, et le serveur répondait 409. Un vendeur qui emballe tout
de suite ne doit pas cliquer trois fois pour le dire. Vers l'avant la machine est
permissive, vers l'arrière elle ne cède jamais.

Côté vendeur, le bouton « Colis prêt, transporteur pas encore passé » apparaît
dans le détail de la commande, à côté de la création d'expédition — et disparaît
une fois l'état atteint plutôt que de proposer une action sans effet.

## 4. Paliers de prix B2B

Le commerce de gros ne se fait pas à prix fixe. TOUMA ne savait pas l'exprimer :
un produit avait un prix, qu'on en achète dix ou dix mille.

`ToumaPriceTier` déclare « à partir de N unités, le prix unitaire est X ». Deux
règles gouvernent son application :

- **Le palier est choisi par le serveur, jamais demandé par le client.** Un client
  qui enverrait « je veux le palier à 500 » est ignoré : seule la quantité
  réellement commandée compte. C'est la règle des totaux, appliquée un cran plus
  tôt.
- **Un palier ne peut pas augmenter le prix.** Un palier au-dessus du prix
  catalogue est soit une erreur de saisie, soit un piège ; dans les deux cas
  l'acheteur paie le prix affiché.

La même fonction pure sert à l'aperçu du panier **et** à l'écriture de la
commande — il n'y a pas deux formules qui pourraient diverger. La ligne de
commande garde dans `metadata` le palier retenu et le prix catalogue d'origine :
sans cette trace, personne ne peut expliquer six mois plus tard pourquoi cette
ligne a été facturée à ce prix-là.

La grille est **publique en lecture** : un acheteur de gros doit pouvoir voir à
partir de quelle quantité le prix baisse. Elle s'écrit par la boutique
propriétaire ; un autre vendeur reçoit « introuvable », jamais « interdit ».

## 5. Origine de la commande

`sourceType` (`CART`, `RFQ`, `DIRECT`, `REORDER`) et `rfqId` sur la commande
globale. Une commande née d'un appel d'offres porte un prix négocié et n'a pas la
même histoire qu'un panier : l'assistance doit pouvoir remonter à la négociation
sans jouer aux devinettes. Le lien vers l'offre acceptée existait déjà dans
l'autre sens (`ToumaQuote.orderGroupId`) — il n'a pas été dupliqué.

## 6. Endpoints

Actions nommées, qui passent toutes par la même machine d'état :

```
POST /api/v1/orders/:id/confirm            (vendeur)
POST /api/v1/orders/:id/process            (vendeur)
POST /api/v1/orders/:id/ready-to-ship      (vendeur)
POST /api/v1/orders/:id/ship               (vendeur)
POST /api/v1/orders/:id/deliver            (vendeur)
POST /api/v1/orders/:id/cancel             (vendeur ou acheteur, selon l'état)
POST /api/v1/orders/:id/confirm-delivery    (acheteur — clôt la commande)
GET  /api/v1/orders/:id/tracking            (participants)

GET  /api/v1/seller/orders                  (alias filtré)
GET  /api/v1/seller/orders/:id

GET  /api/v1/products/:id/paliers            (public)
PUT  /api/v1/products/:id/paliers            (vendeur propriétaire)
```

Elles ne contournent rien : chacune demande une transition précise au service,
qui vérifie le rôle, la propriété et la légalité du passage. Leur intérêt est
ailleurs — « prêt à expédier » se lit dans le journal d'audit, alors que
`PATCH status=READY_TO_SHIP` demande d'y réfléchir.

Le suivi rend **une liste d'expéditions**, jamais un colis unique : supposer
« une commande, un colis » est précisément l'erreur que la V15 corrige.

---

## Ce qui est garanti par les tests

23 tests ajoutés (359 au total, tous au vert).

- le stock réservé revient **exactement** comme il est parti, et rejouer le
  balayage ne le gonfle pas ;
- une commande dont le paiement est engagé n'est **jamais** annulée par le
  balayage ;
- un groupe dont plus aucune sous-commande ne survit passe à « annulée » ;
- la commande globale traverse réellement `PROCESSING` → `PARTIALLY_SHIPPED` →
  `PARTIALLY_DELIVERED` → `DELIVERED` au fil de deux vendeurs qui n'avancent pas
  ensemble ;
- « prêt à expédier » s'intercale, refuse le retour en arrière (409) et reste
  interdit à l'acheteur (403) ;
- le palier est appliqué par le serveur, tracé dans la ligne, et un palier plus
  cher que le prix affiché est ignoré ;
- la grille d'un autre vendeur est « introuvable », et une grille incohérente est
  refusée ;
- le suivi d'une commande d'autrui est introuvable.

---

## Ce qui n'est PAS fait

Par ordre de ce qui manquerait le plus.

- **Ville d'origine/destination et date de livraison estimée sur l'expédition**
  (§14) : les pays y sont, les villes non. Utile le jour où un transporteur réel
  les renvoie — aujourd'hui elles seraient inventées.
- **Statuts de suivi détaillés** (§15) : `PICKED_UP`, `ARRIVED_AT_HUB`,
  `CUSTOMS`, `OUT_FOR_DELIVERY`, `EXCEPTION`. Le passage en douane est le point
  de friction du corridor Tchad ↔ Cameroun, et c'est exactement pour cela qu'il
  ne faut pas l'inventer : ces états doivent correspondre à ce qu'un transporteur
  réel renvoie, sinon l'acheteur lit une fiction.
- **`ELIGIBLE` et `HELD` sur le versement vendeur** (§22) : la logique de
  versement dépend du prestataire et de la réglementation. Poser les états sans
  la règle qui fait passer de l'un à l'autre donnerait un faux sentiment de
  sécurité.
- **Motifs de retour supplémentaires** (§25) : `QUALITY`, `SIZE`,
  `QUANTITY_SHORTAGE`. Une migration d'énumération pour trois valeurs qui ne
  changent aucun comportement — à grouper avec le prochain travail sur les
  retours.
- **Paiements fractionnés, acomptes B2B, versements réels** (§20) : le cahier des
  charges demande lui-même de préparer sans implémenter prématurément. Le modèle
  s'y prête (un paiement couvre le groupe, les commissions sont par
  sous-commande) ; la logique attend un prestataire.
- **Centre de commandes d'administration et recherche transverse** (§32, §33) :
  l'administration voit les commandes, mais sans les filtres croisés demandés.

Rien de tout cela n'est bloquant pour vendre. Les deux premiers points attendent
un transporteur réel ; le troisième attend un prestataire de paiement.
