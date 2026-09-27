# TOUMA V16 — audit préalable

Fait avant d'écrire une ligne, en vérifiant dans le code et non dans la
documentation.

Le constat tient en une phrase : **la mécanique après-vente existe et elle est
solide sur l'argent — mais la pièce sur laquelle les décisions d'argent se
prennent, la preuve, n'est pas fiable.**

---

## 1. Ce qui existe et tient debout

### Retours et remboursements (§2, §9, §10, §11)

`ToumaReturnRequest`, `ToumaReturnItem`, `ToumaRefund` existent avec le
nécessaire : montant **réclamé** et montant **approuvé** séparés, remboursement
partiel, référence du prestataire (`providerRef`), auteur de la décision
(`initiatedById` — toujours un humain).

Le point le plus important est déjà juste : le montant d'un retour **n'est jamais
fourni par le client**, il est recalculé depuis les instantanés de la commande,
et le remboursement est borné par **deux plafonds simultanés** — le solde de la
commande et le montant réellement encaissé par le paiement qui la couvre.

### Contre-passation de commission (§36)

Faite au prorata, en **ligne négative** plutôt qu'en modification de la ligne
d'origine (`refund.service.ts:180`) : la comptabilité est corrigée, jamais
réécrite. C'est exactement ce que demande le §36.

### Achat vérifié (§41)

Un avis n'est possible que sur une commande réellement livrée
(`review.routes.ts:46`). Le vendeur ne peut pas supprimer un avis.

### Litiges (§15, §19)

`ToumaDispute`, `ToumaDisputeMessage` existent, avec messages internes réservés à
l'administration et décision auditée.

---

## 2. Le défaut central : une preuve n'est qu'une URL

**C'est le plus grave, et il concerne les deux côtés du marché.**

```prisma
model ToumaDisputeEvidence {
  kind String
  url  String      // ← déclarée par le client
  note String?
}
```

Et côté retour, `ToumaReturnRequest.evidence` est un `Json` dont le schéma
(`return.schema.ts:26`) accepte `{ url, name, mimeType }` — **tout venant du
navigateur**.

Ce que cela veut dire concrètement :

- **Rien n'est vérifié.** Ni que le fichier existe, ni ce qu'il contient, ni sa
  taille, ni son type réel. Le `mimeType` est celui que le client annonce.
- **La preuve vit ailleurs.** Chez un hébergeur tiers, que son déposant peut
  modifier ou supprimer **après** que la décision a été prise. Une photo de colis
  endommagé peut être remplacée par autre chose le lendemain.
- **Rien ne dit qui l'a déposée.** Pas d'`uploadedById`, pas d'horodatage
  d'origine autre que la ligne, pas d'empreinte.
- **Rien n'est privé.** Une URL publique est une URL publique : la facture d'un
  acheteur ou la photo de son domicile est lisible par quiconque a le lien.

Or c'est sur ces pièces qu'un arbitre décide qui garde l'argent. Le §8 et le §20
demandent `storageKey`, `mimeType`, `size`, `checksum`, et des URL signées — et
la V14 a déjà résolu exactement ce problème pour les pièces jointes de la
messagerie : contenu reçu en corps brut, type reconnu **aux octets**, empreinte
SHA-256, clé non devinable, stockage privé, URL signée à durée courte. Il n'y a
rien à inventer, il y a à réutiliser.

---

## 3. Ce qui manque vraiment

| § | Attendu | État |
| --- | --- | --- |
| §16 | `SELLER_RESPONSE_REQUIRED`, `BUYER_RESPONSE_REQUIRED`, `MEDIATION`, `ESCALATED` | Absents. `DisputeStatus` n'a que `OPEN`, `UNDER_REVIEW`, `RESOLVED_BUYER`, `RESOLVED_SELLER`, `REJECTED`, `CLOSED` |
| §17 | Catégorie de litige | Absente — `reason` est un texte libre |
| §18 | Priorité | Absente |
| §15 | Assignation à un agent | Absente |
| §24/§25 | Délais de réponse et escalade automatique | **Absents** — un vendeur qui ne répond jamais bloque le litige indéfiniment |
| §27/§28 | Type de résolution et instantané | `resolution` est un texte libre ; rien n'est figé |
| §35 | `PayoutHold` | **Absent** — et voir ci-dessous |
| §37 | `LedgerEntry` | **Absent** |
| §2 | `UNDER_REVIEW`, `RETURN_IN_PROGRESS`, `REFUND_PENDING`, `CLOSED` | Absents des statuts de retour |
| §7 | `QUALITY`, `SIZE`, `QUANTITY_SHORTAGE`, `DOES_NOT_WORK` + motifs B2B | Absents |
| §3 | `condition` structurée sur la ligne retournée | Existe mais en texte libre |
| §14 | Webhook de remboursement | Absent (le remboursement est synchrone) |

### Une précision qui change le travail : le versement vendeur n'existe pas

`ToumaSellerPayout` est déclaré dans le schéma et **n'est lu ni écrit nulle part
dans le code** — la recherche `toumaSellerPayout` dans `src/touma/` ne renvoie
rien.

Poser un `PayoutHold` sur des versements qui ne sont jamais créés serait de la
façade : un garde-fou qui garde une porte qui n'existe pas. Le besoin réel
derrière le §35 est autre chose — **savoir combien d'argent d'un vendeur ne doit
pas partir**. C'est un solde, pas un verrou sur une ligne fantôme.

---

## 4. Ce que la V16 va faire

Par ordre de valeur, et en suivant la priorité que le cahier des charges affiche
lui-même : intégrité financière et protection des deux côtés.

1. **Rendre les preuves fiables.** Contenu reçu en corps brut, reconnu à ses
   octets, empreinté, rangé sous une clé non devinable, servi par URL signée aux
   seules parties du litige. Réutilisation directe du stockage V14.
2. **Rendre les preuves immuables.** Une preuve déposée ne se modifie pas ; son
   retrait est un acte d'administration, tracé, qui la marque retirée plutôt que
   de l'effacer — on ne supprime pas une pièce d'un dossier après coup.
3. **Un registre append-only** (`LedgerEntry`) : vente, commission,
   remboursement, contre-passation. Chaque mouvement porte son montant, sa
   devise, son sens et sa référence. C'est ce qui donne « chaque transaction
   possède un historique vérifiable » (§64) — et ce sur quoi un solde vendeur
   peut être calculé plutôt que supposé.
4. **Des fonds retenus calculés sur ce registre** quand un litige est ouvert :
   la réponse honnête au §35 tant qu'aucun versement réel n'existe.
5. **Des délais de réponse et une escalade** qui ne dépendent pas du navigateur,
   balayés côté serveur comme les réservations de la V15.
6. **Catégorie, priorité, assignation, type de résolution et instantané figé.**

Ce qui ne sera pas fait figure à la fin de `TOUMA-V16-TRUST-SAFETY.md`, avec la
raison. En particulier, le §65 est explicite et je m'y tiens : **aucun versement
réel, aucun transfert d'argent simulé** tant qu'aucun prestataire n'est raccordé.
