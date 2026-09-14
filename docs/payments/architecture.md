# TOUMA Pay — architecture

Comment l'argent circule dans TOUMA, et **pourquoi** chaque pièce est là.

La frontière réglementaire — ce que TOUMA fait et ne fait pas avec l'argent des
autres — est dans `compliance-boundaries.md`. Lire ce fichier-là d'abord.

---

## Le trajet d'un franc

```
Panier
  └─ Checkout ──────────► ToumaOrderGroup (payé une fois)
                             └─ ToumaOrder (une par boutique)
                                  ├─ commission calculée côté serveur
                                  └─ code de retrait si point relais

Paiement
  └─ ToumaPayment ──────► prestataire (intention)
       │                     └─ webhook signé ──► applySuccess()
       │
       └─ applySuccess() est le SEUL chemin d'entrée de l'argent :
            ├─ ToumaLedgerEntry   (vente, commission)
            ├─ ToumaCommission    (une fois par commande)
            ├─ ToumaSettlementAllocation (une par boutique)
            └─ facture + reçu

Après-vente
  └─ ToumaRefund ───────► refundService : UN seul moteur
       ├─ plafond commande + plafond paiement
       ├─ contre-passation de commission (ligne négative)
       ├─ ToumaLedgerEntry (remboursement)
       └─ part de règlement diminuée

Règlement
  └─ ToumaSettlementAllocation
       ├─ PENDING  : fenêtre de protection
       ├─ ELIGIBLE : livrée + fenêtre écoulée + aucun litige bloquant
       └─ SETTLED  : rattachée à un ToumaSellerPayout

Écrans
  └─ /vendeur/finance ── ce qui est dû, par devise, avec le motif d'un retard
  └─ /admin/versements ─ créer, retenir, libérer, annuler — jamais virer
```

---

## Les décisions qui structurent le reste

### Un seul chemin d'entrée, un seul chemin de sortie

`applySuccess()` est le seul endroit où l'argent entre. `refundService` est le
seul endroit d'où il sort.

Ce n'était pas le cas : il existait **deux moteurs de remboursement qui
s'ignoraient**. Celui de l'administration mettait à jour le paiement et
s'arrêtait là — aucune ligne de remboursement, rien au registre, aucune
commission rendue. Le registre continuait donc d'affirmer que la boutique avait
gagné l'argent rendu à l'acheteur.

Deux entrées au registre, c'est deux occasions de diverger. Une seule, c'est une
seule chose à vérifier.

### Le montant est un `Decimal`, jamais un flottant

Tout montant en base est `Decimal(18, 4)`. `src/touma/lib/money.ts` centralise
les opérations et **refuse d'additionner deux devises** sans taux officiel.

Corollaire tenu partout : un solde est rendu **par devise**. Sans taux, une
somme XAF + EUR serait un chiffre inventé, et un chiffre inventé dans un
registre est pire qu'une absence de chiffre.

### Le registre est append-only, le solde est calculé

Aucune fonction de mise à jour ni de suppression n'existe sur
`ToumaLedgerEntry` : c'est une contrainte de conception, pas un oubli. Une
correction est une ligne de sens inverse.

Le solde n'est jamais stocké. Un solde stocké finit toujours par diverger de ses
mouvements, et le jour où cela arrive, personne ne sait lequel des deux a
raison.

### Ce qui est dû n'est pas ce qui est possédé

`ToumaSettlementAllocation` dit ce qui revient à une boutique. Ce n'est **pas**
un portefeuille : aucun solde n'est détenu pour le compte d'un vendeur.

La distinction sépare une place de marché d'un établissement de paiement. Elle
se lit dans le modèle, et elle doit continuer de s'y lire.

### La commission se paramètre, et ne se réécrit pas

Le taux était `TOUMA_COMMISSION_RATE` : une variable d'environnement, une seule,
pour tout le monde. Accorder un taux négocié à un gros vendeur ou abaisser celui
d'une catégorie à faible marge demandait de changer le taux de **tous**, y
compris pour des factures pas encore émises.

Quatre portées, précision croissante : globale, pays, catégorie, boutique. La
plus précise l'emporte ; à précision égale, la plus récemment entrée en vigueur.
Sans aucune règle, la variable reste le repli — l'absence de configuration ne
doit pas faire tomber la commission à zéro.

**Une règle qui a servi ne se modifie jamais.** Il n'existe ni route de
modification ni suppression : on clôt (`effectiveUntil`) et on rouvre. Une
commande passée doit rester explicable par la règle qui l'a produite.

**Et le taux retenu est figé sur la commande.** Sans cela, la commission
enregistrée à l'encaissement serait calculée avec le taux du jour, pas celui qui
a produit le montant — c'était le cas, et la contre-passation d'un remboursement
souffrait du même défaut.

Une borne de commission (plancher, plafond) porte sa devise. Une borne libellée
dans une autre devise que la commande rend la règle **inapplicable** plutôt
qu'approximative : convertir sans taux officiel produirait un plafond inventé.

### L'idempotence est une ceinture, pas le seul appui

`Idempotency-Key` sur les routes qui déplacent de l'argent. Une requête rejouée
reçoit **la réponse d'origine**, pas une erreur — un client qui redemande
poliment la même chose doit obtenir la même réponse, sinon il redemande encore.

Mais chaque route garde ses garde-fous métier : plafonds, statuts, prises
conditionnelles. L'idempotence rattrape le réseau, elle ne remplace pas la
logique.

### Un balayage parcourt tout, ou le dit

`refreshEligibility` ne lisait que les **500 premières** parts en attente, sans
ordre ni suite. Au-delà — un volume ordinaire pour une place de marché — les
suivantes n'étaient jamais examinées : aucune erreur, aucun journal, des
vendeurs qui cessent d'être réglés, et un balayage qui a l'air de fonctionner.

Il parcourt maintenant par lots jusqu'à épuisement. Le garde-fou qui subsiste
existe contre une boucle infinie, pas pour plafonner le travail utile : quand il
est atteint, le résultat porte `truncated` et le journal le dit. **Un balayage
qui s'arrête doit le dire** — c'est la version, côté exploitation, de la règle
qui gouverne tout le reste : ne jamais laisser croire que quelque chose a été
fait.

### Rien ne se décide tout seul

Aucun remboursement automatique, aucun versement automatique, aucune sanction
automatique. Un délai qui expire porte un dossier devant un humain ; il ne
tranche pas. Une part devient « réglable » ; elle ne se paie pas seule.

---

## La machine d'état des paiements

```
PENDING ──► PROCESSING ──► SUCCEEDED ──► PARTIALLY_REFUNDED ──► REFUNDED
   │                          │
   ├──► FAILED                └──► (remboursement intégral) ──► REFUNDED
   └──► CANCELLED
```

**Limite connue et assumée.** Les états `REQUIRES_ACTION`, `AUTHORIZED`,
`CAPTURED` et `EXPIRED` demandés par le cahier des charges n'existent pas
encore. Pour le mobile money, `REQUIRES_ACTION` n'est pas un détail de
vocabulaire : c'est la différence entre « votre paiement attend votre validation
sur votre téléphone » et un écran qui ne dit rien.

Ils seront ajoutés **avec le premier prestataire réel**, parce que c'est lui qui
dira lesquels il emploie réellement. Les inventer d'avance produirait une
machine d'état qui ne correspond à aucun prestataire.

## Les webhooks

Un webhook est la seule chose qu'un tiers non authentifié peut pousser dans le
système. Trois règles en découlent.

**La signature couvre l'horodatage.** Le schéma est celui des prestataires
réels : `t=<secondes unix>,v1=<hmac de "<t>.<corps brut>">`. L'horodatage est
*dans* la signature — à côté, il serait réécrit par quiconque rejoue la requête,
et ne prouverait rien.

Au-delà de la fenêtre d'acceptation (5 minutes par défaut), un webhook pourtant
bien signé est refusé, dans les deux sens : un horodatage dans le futur trahit
une horloge fausse ou une tentative de prolonger la fenêtre. L'anti-rejeu par
identifiant ne couvrait pas ce cas — un webhook valide capté en transit, jamais
délivré, puis injecté des mois plus tard porte un identifiant jamais vu.

**Chaque réception laisse une trace, y compris refusée.** `ToumaWebhookDelivery`
consigne l'issue (acceptée, doublon, signature invalide, périmée, malformée,
prestataire inconnu, paiement inconnu), l'origine et l'âge de la signature. Un
rejet n'était auparavant que journalisé, donc perdu — alors que c'est exactement
la trace qu'on voudra le jour où quelqu'un tente d'en forger un.

**L'appelant n'apprend rien.** Le motif du refus est dans la trace, jamais dans
la réponse : dire à quelqu'un *pourquoi* sa signature est refusée l'aide à en
produire une valide.

Le corps, lui, n'est jamais conservé tel quel. Il est rédigé (`lib/redact.ts` :
carte, cryptogramme, code secret, clé de prestataire, jeton), tronqué, et
remplacé par son empreinte SHA-256 — assez pour reconnaître deux tentatives
identiques, pas assez pour qu'un tiers écrive sans borne dans la base. Et la
table se purge : une table qu'un inconnu fait grossir devient sinon la panne.

## Ce qui est proposé au moment de payer

`GET /payments/methods` répond à une question que `/providers` ne pose pas.
`/providers` liste les adaptateurs **enregistrés dans le code** ; ce n'est pas la
même chose qu'un moyen de paiement ouvert.

Chaque méthode sort avec son `available` **et** son motif quand c'est non. Taire
les méthodes fermées laisserait l'interface inventer ses propres explications —
et une explication inventée sur un paiement est exactement ce que le §80
interdit.

L'adaptateur de démonstration est annoncé comme tel : les méthodes qu'il porte
sortent `simulated: true`, et en production il est refusé — « Provider réel non
activé — configuration requise ». Transformer une simulation en prétendu
paiement réel est ce que le §52 interdit nommément.

Le paiement à la livraison ne dépend d'aucun prestataire : il dépend d'une
règle. Sans destination, la réponse ne statue pas — il dépend du pays, de la
province, de la boutique et de la catégorie, et deviner produirait la moitié du
temps une promesse fausse.

Les sondes `/api/v1/health` et `/api/v1/ready` accompagnent l'API plutôt que la
racine du processus : un client de la v1 n'a pas à connaître le serveur qui
l'héberge. `/ready` dit aussi si le prestataire de paiement est **réel** — une
sonde qui laisserait croire qu'un prestataire agréé est raccordé tromperait la
personne d'astreinte au pire moment.

## Le paiement à la livraison

Un cas à part, et le plus important au Tchad.

`CASH_ON_DELIVERY` ne passe **pas** par la confirmation ordinaire. La commande
avance — acceptée, préparée, expédiée — mais n'est **jamais dite payée**. Le
montant à collecter est suivi (`ToumaCashCollection`), et l'argent n'entre au
registre qu'au moment où un vendeur **constate** la remise.

L'acheteur ne confirme jamais lui-même : déclarer soi-même avoir payé n'est pas
une preuve de paiement.

Le mode est **fermé par défaut** et s'ouvre par règle (`ToumaCodRule`) : pays,
province, boutique, catégorie, plafond. Encaisser du liquide engage un vendeur
et un livreur — cela ne s'active pas par oubli de configuration.

---

## Ce qui n'est pas construit, et pourquoi

- **Aucun prestataire réel.** Tant que les variables d'environnement sont vides,
  le prestataire est *indisponible*. Inventer des points d'entrée plausibles
  donnerait du code qui compile, passe les tests et échoue à la première vraie
  transaction.
- **Aucune réconciliation.** Elle compare le registre TOUMA aux transactions du
  prestataire : sans prestataire, elle n'a rien à comparer. Le jour où il y en a
  un, c'est ce qui manquera en premier.
- **Aucune remise de commission automatique.** Un palier de volume, une
  dégressivité mensuelle, une promotion de taux : la règle existe, le
  déclencheur automatique non. Un taux se pose à la main, et c'est voulu tant
  que personne n'a décidé de la politique.

Ces manques sont listés parce qu'ils sont réels, pas pour la forme. Le §80 est
la règle : **ne jamais déclarer disponible ce qui ne l'est pas.**
