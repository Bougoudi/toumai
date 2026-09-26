# TOUMA V20 — audit de l'infrastructure financière existante

Écrit en lisant le code et en interrogeant la base, pas la documentation. Il dit
ce qui existe réellement dans les versions V1 → V17, ce qui est cassé, et ce qui
manque avant de pouvoir parler d'une infrastructure de paiement.

---

## 0. Deux corrections de cadrage, avant tout le reste

Le cahier des charges V20 décrit une pile et une histoire qui ne sont pas celles
de ce dépôt. Mieux vaut le dire ici que le laisser croire dans le code.

**La pile n'est pas NestJS.** Le dépôt est **Express + Prisma + PostgreSQL**,
avec une PWA servie en statique et une vitrine Next.js dans `apps/web`. Le
domaine TOUMA vit dans `src/touma/`, monté sur `/api/v1`. Le chemin
`apps/api/src/modules/payments/` du §1 n'existe pas et ne sera pas créé : le §1
autorise explicitement de « respecter la structure actuelle si elle est
différente », et créer une seconde arborescence à côté de celle qui fonctionne
produirait deux maisons à moitié habitées.

**Il n'y a pas de V18 ni de V19.** Les versions livrées vont jusqu'à la V17
(infrastructure nationale tchadienne). Le §22 demande de « connecter V19
Intelligence / Risk » : ce qui existe s'appelle `src/touma/risk/` et
`src/touma/admin/intelligence.service.ts`, et c'est à cela que le raccordement
se fera.

---

## 1. Ce qui existe déjà, et qui est bon

À dire avant le reste, parce que cela détermine ce qu'il ne faut **pas** refaire.

- **L'abstraction prestataire existe** (`PaymentProvider` :
  `createPayment`, `confirmPayment`, `refundPayment`, `verifyWebhook`). Aucun
  opérateur n'est codé en dur dans les services métier. Le §2 est donc
  largement satisfait — il manque des opérations, pas l'architecture.
- **Les montants sont justes.** Tout est `Decimal(18,4)` en base, `money.ts`
  centralise les calculs, et **les devises ne sont jamais additionnées sans
  taux**. Le §30 et une bonne part du §31 sont tenus.
- **Le webhook est signé et anti-rejeu.** Signature HMAC vérifiée sur le corps
  **brut**, comparaison à temps constant, unicité de `externalId` qui empêche
  qu'un même événement soit appliqué deux fois.
- **Un registre append-only existe** (`ToumaLedgerEntry`) : aucune fonction de
  mise à jour ni de suppression, solde calculé jamais stocké, écriture
  idempotente par clé `(referenceType, referenceId, type)`.
- **Les remboursements sont doublement bornés** : solde remboursable de la
  commande **et** montant réellement encaissé sur le paiement.
- **Le paiement à la livraison ne ment plus** (V17) : la commande n'est jamais
  dite payée avant qu'un vendeur constate la remise, le montant à collecter est
  suivi, et le mode est fermé tant qu'aucune règle ne l'ouvre.
- **Le client ne décide jamais qu'un paiement a réussi** : le prestataire vient
  de la configuration serveur, jamais de la requête.

---

## 2. Défauts réels trouvés

### 2.1 `ToumaSellerPayout` est déclaré et n'est utilisé nulle part

```
$ grep -rn "toumaSellerPayout" src/ tests/
src/touma/admin/analytics.service.ts:9:  * … vivent dans `ToumaCommission` / `ToumaSellerPayout`.
```

Une seule occurrence, **dans un commentaire**. Aucun versement n'est jamais
créé, lu ni modifié. Le modèle existe depuis plusieurs versions et n'a jamais
servi — constat déjà fait en V16, toujours vrai.

Son énumération est en outre incomplète au regard du §8 :

```prisma
enum PayoutStatus { PENDING  PROCESSING  PAID  FAILED }
```

Manquent `ELIGIBLE`, `CANCELLED`, `ON_HOLD` — c'est-à-dire précisément les états
qui font la différence entre une table et un processus de règlement.

**Conséquence concrète** : un vendeur n'a aujourd'hui aucun moyen de savoir ce
qui lui est dû, quand il sera payé, ni pourquoi un versement est retenu.

### 2.2 Il n'existe aucune couche d'idempotence générale

Le §5 demande une table `IdempotencyKey`. Il n'y en a pas :

```
$ grep -c "model.*Idempotency" prisma/schema.prisma
0
```

Ce qui existe est **ad hoc, opération par opération** :

| Opération | Protection | Verdict |
|---|---|---|
| `POST /checkout` | `checkoutKey` sur la commande | ✅ |
| `POST /payments/create` | `idempotencyKey` unique sur le paiement | ✅ |
| `POST /payments/refund` | **aucune** | ❌ |
| Versements | inexistants | ❌ |
| `POST /payments/:id/cash/collect` | statut `COD_COLLECTED` | partiel |

Deux conséquences : un remboursement rejoué sur un réseau instable — le cas
tchadien par excellence — n'est arrêté par rien d'autre que le plafond, et une
réponse n'est jamais rejouée à l'identique (le client reçoit une erreur là où il
devrait recevoir la réponse d'origine).

### 2.3 Le total remboursé d'un paiement est écrit depuis une lecture périmée

Dans `refund.service.ts`, le montant cumulé est calculé **avant** l'appel au
prestataire, puis écrit en valeur absolue :

```ts
const totalRefunded = payment.refundedAmount.plus(amount);   // lecture d'avant
// …
await tx.toumaPayment.update({ data: { refundedAmount: totalRefunded, … } });
```

Deux remboursements partiels simultanés lisent tous deux `refundedAmount = 0`,
puis **s'écrasent l'un l'autre** : le champ vaut le montant du dernier, pas la
somme. Le garde-fou qui suit la création (relecture de la somme des lignes de
remboursement contre le total de la commande) empêche le dépassement au niveau
de la **commande**, mais laisse `payment.refundedAmount` et le statut du
paiement faux.

C'est le seul défaut de cet audit qui touche directement un montant.

### 2.4 La commission est un taux global unique

```
src/config/env.ts:105:  commissionRate: Number(process.env.TOUMA_COMMISSION_RATE ?? 0.05),
```

Lu en cinq endroits (checkout, paiement, remboursement, B2B, route publique).
Le §7 demande de pouvoir varier par vendeur, catégorie, pays et promotion :
**rien de tout cela n'est possible**. Il n'y a qu'un nombre.

À noter aussi : la source de vérité est un `Number` JavaScript converti en
`Decimal` à l'écriture. Le passage par un flottant pour un taux qui multiplie
des montants est fragile par principe.

### 2.5 Aucune répartition multi-vendeurs explicite

Le panier multi-vendeurs crée bien un groupe payé une fois et des sous-commandes
par boutique, chacune avec sa commission. Mais il n'existe **aucun objet de
répartition** (`SettlementAllocation`, §9) qui dise, pour un paiement donné :
quelle part revient à quel vendeur, quelle commission, quel transport, quel
remboursement, quel net.

Aujourd'hui la réponse se reconstitue en croisant trois tables. Cela suffit pour
afficher, pas pour régler — et surtout pas pour expliquer un écart.

### 2.6 Aucune réconciliation

Le §12 n'a aucun équivalent dans le code. Rien ne compare le registre TOUMA aux
transactions du prestataire. Tant qu'aucun prestataire réel n'est raccordé, cela
ne coûte rien ; le jour où il l'est, c'est ce qui manque pour savoir si l'argent
attendu est arrivé.

### 2.7 La machine d'état du paiement est grossière

```prisma
enum PaymentStatus { PENDING PROCESSING SUCCEEDED FAILED CANCELLED REFUNDED PARTIALLY_REFUNDED }
```

Manquent les états que le §4 demande et que tout prestataire réel renvoie :
`REQUIRES_ACTION` (le cas normal du Mobile Money — l'acheteur doit valider sur
son téléphone), `AUTHORIZED`, `CAPTURED`, `EXPIRED`. Et **aucune table de
transitions** ne déclare ce qui est permis : les statuts sont posés là où le
code le juge bon.

Pour le Tchad, l'absence de `REQUIRES_ACTION` et d'`EXPIRED` n'est pas un détail
de vocabulaire : c'est la différence entre « votre paiement attend votre
validation » et un écran qui ne dit rien.

### 2.8 Les événements de webhook ne sont pas distingués des événements de paiement

`ToumaPaymentEvent` sert aux deux. Le §11 demande un `PaymentWebhookEvent`
portant `signatureVerified`, `payloadHash`, `processed`, `processedAt`, `error`.
Aujourd'hui, un webhook **rejeté pour signature invalide ne laisse aucune
trace** : il est refusé et journalisé, rien de plus. C'est précisément la trace
qu'on veut avoir le jour où quelqu'un tente d'en forger un.

### 2.9 Aucune protection d'horodatage sur les webhooks

La signature est vérifiée, l'unicité de l'événement aussi. Mais un webhook
valide capté puis rejoué **six mois plus tard** avec un `id` jamais vu serait
accepté. Le §11 demande une validation d'horodatage ; elle n'existe pas.

### 2.10 `/health` n'est pas sous `/api/v1`

```
src/app.ts:114:  app.get('/health', …)
src/app.ts:118:  app.get('/ready', …)
```

Le §40 demande `GET /api/v1/health`. Les sondes existent et sont bonnes
(`/ready` vérifie réellement PostgreSQL) mais ne sont pas là où l'API les
annonce. Et il n'existe pas de `/api/v1/health/payments`.

### 2.11 Aucun point d'entrée « moyens de paiement disponibles »

Le §3 demande `GET /api/v1/payments/methods` rendant les méthodes réellement
utilisables pour un pays et une devise. Ce qui existe est
`GET /api/v1/payments/providers`, qui liste **ce que les adaptateurs savent
faire** — pas ce qui est ouvert. C'est exactement la confusion que le §80
interdit : un adaptateur qui existe n'est pas un moyen de paiement disponible.

### 2.12 Deux scories de schéma

- Le commentaire `/// Versement au vendeur (net de commission).` est resté
  accroché au-dessus de `ToumaLedgerEntry` : il décrit un autre modèle.
- Dans `ToumaPayment`, la relation `cashCollection` a été écrite **après**
  `@@map` (introduit en V17). Prisma l'accepte, mais c'est illisible.

---

## 3. Points d'audit explicitement demandés — verdict

| Point (§ « à auditer impérativement ») | Verdict |
|---|---|
| Modèle `Address` vs contrôleurs | **Sain.** Corrigé en V17 : géographie vérifiée, téléphones E.164, cohérence province/localité contrôlée |
| Architecture `Order` / `SellerOrder` | **Sain.** Un `ToumaOrderGroup` payé une fois, une `ToumaOrder` par boutique. Le statut du groupe est déduit, jamais posé |
| Modèle `Payment` | Correct sur les montants ; **machine d'état insuffisante** (§2.7) |
| `PaymentEvent` et idempotence | **Anti-rejeu correct** par `externalId` unique ; pas de trace des webhooks rejetés (§2.8) |
| Remboursements | Plafonds justes ; **écriture concurrente fautive** (§2.3) ; pas d'idempotence (§2.2) |
| Commissions | Fonctionnelles ; **taux unique non paramétrable** (§2.4) |
| `SellerPayout` | **Mort-né** (§2.1) |
| `Dispute.resolvedBy` | **N'existe pas sous ce nom.** La décision est tracée par `resolutionSnapshot.decidedBy` et le journal d'audit, ce qui est plus riche. Aucun défaut |
| Endpoint health et préfixe `/api/v1` | **Mal placé** (§2.10) |
| Webhooks | Signés, anti-rejeu ; **pas d'horodatage** (§2.9), pas de table dédiée (§2.8) |
| Transactions Prisma | **Correctes** aux endroits qui comptent : checkout, réussite de paiement, remboursement, décision de litige |
| Références Payment / Order / SellerOrder / Refund / Payout | Cohérentes, **sauf** que `Payout` n'est relié à rien de vivant |

---

## 4. Ordre de travail retenu

Dans cet ordre, parce que chaque étape s'appuie sur la précédente et que les
deux premières corrigent des défauts existants :

1. **Corriger l'écriture concurrente du montant remboursé** (§2.3) — c'est le
   seul défaut qui touche un montant.
2. **Couche d'idempotence générale** (§2.2) : table, clé, rejeu de la réponse
   d'origine, appliquée aux remboursements et à tout ce qui bouge de l'argent.
3. **Configuration des commissions** (§2.4) : par vendeur, catégorie, pays,
   avec période de validité.
4. **Répartition multi-vendeurs** (§2.5) et **cycle de vie des versements**
   (§2.1), avec règles d'éligibilité configurables.
5. **Machine d'état du paiement** (§2.7) et **moyens de paiement réellement
   disponibles** (§2.11).
6. **Webhooks : table dédiée et horodatage** (§2.8, §2.9).
7. **Réconciliation** (§2.6).
8. **Santé sous `/api/v1`** (§2.10) et scories de schéma (§2.12).
9. Documentation, dont `docs/payments/compliance-boundaries.md` — la frontière
   entre ce que TOUMA fait et ce qui relève d'un établissement agréé.

Ce qui ne sera **pas** fait, et pour la même raison qu'aux versions
précédentes : aucun prestataire réel ne sera écrit sans documentation ni
identifiants, aucun taux de change ne sera inventé, et aucune fonction
réglementée — garde de fonds, crédit, transfert d'argent — ne sera implémentée
pour faire marcher une démonstration.
