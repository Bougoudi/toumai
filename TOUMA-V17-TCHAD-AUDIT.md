# TOUMA V17 — audit avant le lancement national tchadien

Ce document dit **ce qui existe réellement** dans le code des versions V1 à V16,
et **ce qui empêche aujourd'hui un lancement dans les 23 provinces du Tchad**.
Il a été écrit en lisant le code et en interrogeant la base, pas la
documentation.

La conclusion tient en une phrase : la plateforme sait vendre, encaisser,
expédier, arbitrer — mais elle **ne sait pas où se trouvent les gens**.

---

## 1. Ce qui est déjà en place, et solide

Il faut le dire avant le reste, parce que cela détermine ce qu'il ne faut
**pas** refaire.

- **Le Tchad est déjà un pays configuré.** En base : `TD`, `Tchad`, devise
  `XAF`, indicatif `+235`, `active: true`, achat et vente autorisés. Le Cameroun
  aussi. Les six autres pays sont présents mais inactifs. Le modèle `Country`
  n'est donc pas à créer.
- **Les adresses connaissent déjà les réalités locales.** `ToumaAddress` porte
  `district`, `landmark`, `instructions`, `latitude`/`longitude`, et
  `postalCode` est **déjà nullable**. Le commentaire du schéma dit exactement
  pourquoi : « beaucoup de lieux n'ont ni rue nommée ni code postal ». Le §6 et
  le §7 sont donc en grande partie déjà satisfaits — il manque le rattachement
  à une géographie officielle, pas les champs de terrain.
- **Le retrait en point relais existe** comme mode de remise à part entière
  (`ToumaPickupPoint`, `deliveryMethod: PICKUP_POINT`), avec contrôle que le
  point est actif et dans le bon pays.
- **Les abstractions demandées par les §16, §25 et §27 existent déjà** :
  `LogisticsProvider` (`getQuote`, `createShipment`, `getTracking`),
  `PaymentProvider` (`createPayment`, `confirmPayment`, `refundPayment`,
  webhook signé). Aucun opérateur n'est codé en dur dans les services métier.
- **L'argent est juste.** Tout montant est un `Decimal(18,4)`, les devises ne
  sont jamais additionnées sans taux, le registre comptable est append-only, les
  remboursements sont doublement bornés.
- **Les parcours B2C et B2B fonctionnent de bout en bout**, y compris le panier
  multi-vendeurs, la négociation, les retours et les litiges.

---

## 2. Le défaut central : la géographie est du texte libre

C'est la racine de presque tout le reste.

Aujourd'hui, une localisation est une **chaîne de caractères saisie à la main** :

```prisma
model ToumaAddress {
  city        String      // saisi librement
  region      String?     // saisi librement, et quasiment inutilisé
  district    String?     // saisi librement
  countryCode String      // seule donnée réellement structurée
}

model ToumaStore {
  city String?            // saisi librement
}

model ToumaPickupPoint {
  city String             // saisi librement
}
```

Il n'existe **aucune table** `Province`, `Department`, `SubPrefecture` ou
`Locality`. Le mot « province » n'apparaît nulle part dans `src/touma/`.

Les conséquences sont concrètes, pas théoriques :

- **« N'Djamena », « Ndjamena », « N'Djaména » et « ndjamena » sont quatre
  villes différentes** pour la base. Aucun regroupement, aucun filtre, aucune
  statistique par province n'est possible.
- **Le champ `region` est mort.** Il est accepté à l'inscription, recopié dans
  l'instantané de commande, affiché une fois dans la liste d'adresses — et
  n'alimente aucune recherche, aucun calcul, aucun filtre.
- **Il n'existe aucune recherche par province** (§12, §33) : ni « vendeurs au
  Ouaddaï », ni « grossiste Moundou ». On ne peut pas filtrer sur un champ qui
  n'existe pas.
- **Aucune statistique par province** n'est calculable (§36, §56), donc le
  tableau de bord national du §34 ne peut pas être construit honnêtement.
- **La disponibilité régionale d'un produit** (§13) et la **zone de service d'un
  vendeur** (§42, §43) n'ont aucun support : `availabilityScope` et
  `SellerServiceArea` n'existent pas.

**C'est le premier chantier, et il commande tous les autres.**

---

## 3. Défauts qui feraient perdre de l'argent ou de la confiance

Ceux-ci sont indépendants de la géographie, et graves.

### 3.1 Le paiement à la livraison est considéré comme encaissé

`CASH_ON_DELIVERY` est proposé comme méthode de paiement
(`payment.routes.ts:15`, `payment.types.ts:22`) et l'adaptateur de
démonstration le confirme **`SUCCEEDED` comme n'importe quel autre**
(`mock.provider.ts:45-50`).

Conséquence, dans l'ordre où elle se produit : la commande passe à « payée », la
facture et le reçu sont émis, le vendeur est notifié « commande payée :
préparez l'expédition », et la vente entre au registre comptable — **avant qu'un
seul franc ait été collecté**.

Le §28 l'interdit explicitement. C'est un mensonge sur l'argent, et il est
d'autant plus dangereux au Tchad que le paiement à la livraison y est un mode
courant.

### 3.2 Le retrait en point relais n'a aucun code

Le flux du §19 existe jusqu'à l'arrivée du colis. Il manque la dernière marche :
**rien ne prouve que celui qui se présente au point relais est le
destinataire**. Aucun champ `pickupCode` n'existe nulle part dans le schéma.

N'importe qui connaissant le numéro de commande peut retirer le colis.

### 3.3 Les délais et prix de livraison sont inventés, et à l'échelle du pays

L'adaptateur de démonstration facture et date **toutes** les livraisons
nationales à l'identique (`mock.provider.ts:33-46`) :

> prise en charge nationale 1 500 · + 1 200 par kilogramme entamé · délai 1 à
> 3 jours

Autrement dit, **N'Djamena → N'Djamena et N'Djamena → Faya-Largeau** — un millier
de kilomètres de piste saharienne — reçoivent le **même prix et le même délai**.
Le fichier est honnêtement nommé « mock » et sa grille est documentée, mais
c'est le **seul** fournisseur branché : l'acheteur voit donc toujours une
estimation, et cette estimation n'a aucun fondement.

Pire : comme le mock répond toujours, le système **ne sait jamais dire « je ne
sais pas »**. Le §40 demande exactement l'inverse — « Estimation
indisponible » quand aucun fournisseur ne peut calculer.

Il n'existe ni `DeliveryZone` (§15) ni `TradeRoute` (§24) : aucune façon pour un
administrateur de déclarer ce qui est réellement livrable, et à quel prix.

### 3.4 Les numéros de téléphone sont stockés dans n'importe quel format

La seule validation est `^\+?[0-9\s-]{6,20}$` (`auth.schema.ts:9`). Sont donc
acceptés et stockés tels quels : `66 12 34 56`, `+235 66123456`, `0066123456`,
`235-66-12-34-56`. Le profil d'entreprise est encore plus permissif :
`z.string().trim().max(30)`.

Conséquence : deux comptes du même numéro ne sont pas reconnaissables, aucun SMS
ne pourra être envoyé de façon fiable, et la détection de fraude par numéro
(§53) est impossible. Le §8 demande E.164 ; rien n'est normalisé aujourd'hui.

---

## 4. Ce qui manque, sans être cassé

- **Aucune internationalisation** (§32). Tous les textes de l'interface sont
  écrits en français dans le code. L'arabe, deuxième langue officielle du
  Tchad, n'est pas préparé — ni dans les libellés, ni dans les données
  (`Country.name`, noms de lieux).
- **Aucun fuseau horaire** n'est attaché au pays (§2) : `Africa/Ndjamena`
  n'apparaît nulle part.
- **Aucune exception de livraison** (§21) : ni `DeliveryException`, ni motif,
  ni traitement par l'assistance.
- **Aucun drapeau de fonctionnalité** (§77) ni mode pilote (§78).
- **Aucun tableau de bord de santé** (§76) montrant `UP` / `DOWN` /
  `NOT_CONFIGURED` par dépendance.
- **`ToumaSellerPayout` reste déclaré et jamais utilisé** — constat déjà fait en
  V16, toujours vrai.

---

## 5. La contrainte que la source de données impose

Le §58 est catégorique : « Ne pas inventer les départements/localités ».
L'audit doit donc dire ce que la source fiable contient **et ce qu'elle ne
contient pas**.

Source retenue : **GeoNames**, licence CC BY 4.0 (détail et justification dans
`docs/chad-geography-sources.md`).

| Niveau demandé par le §4 | Disponible ? | Ce que dit la source |
|---|---|---|
| Province (ADM1) | **Oui, 23** | Correspondent exactement à la liste du §3 |
| Département (ADM2) | **Oui, 133** | Tous rattachés à leur province |
| Sous-préfecture (ADM3) | **Non, 0** | GeoNames ne descend pas à ce niveau pour le Tchad |
| Localité | **Oui, 12 278** | Avec coordonnées |

Deux limites doivent être assumées plutôt que contournées :

1. **Les sous-préfectures n'existent dans aucune source exploitable ici.** La
   table sera créée — le modèle du §4 la prévoit — et **restera vide**. La
   remplir de mémoire reviendrait à inventer des subdivisions administratives
   d'un État, ce que le §58 interdit.

2. **Les localités ne sont pas rattachées à leur département.** Sur 12 278
   localités, **une seule** porte un code de département dans la source. Elles
   portent toutes, en revanche, leur province. Rattacher les 12 277 autres à un
   département « au plus proche » serait une invention massive présentée comme
   une donnée officielle. `Locality.departmentId` sera donc **nullable** — une
   déviation assumée par rapport au modèle du §4, et la seule honnête.

---

## 6. Ordre de travail retenu

Dans l'ordre, parce que chaque étape s'appuie sur la précédente :

1. **Géographie réelle** — modèles `Province` / `Department` / `SubPrefecture` /
   `Locality`, seed reproductible depuis GeoNames, source documentée.
2. **Adresses rattachées** à cette géographie, sans casser les adresses
   existantes ni les instantanés de commandes passées (§55).
3. **Téléphones en E.164**, avec `+235` par défaut.
4. **Les trois défauts d'argent et de confiance** : le paiement à la livraison
   qui n'en est pas un, le retrait sans code, la livraison inventée — remplacée
   par des zones configurées, avec un « je ne sais pas » possible.
5. **Découverte et recherche par province**, disponibilité régionale, zones de
   service des vendeurs.
6. **Administration nationale** : gestion de la géographie, statistiques par
   province calculées sur des faits réels.
7. **Tests** par province et entre provinces, documentation, liste de
   vérification avant mise en service.

Ce qui ne pourra pas être fait sans décision d'exploitation — prestataire de
paiement réel, transporteur réel, opérateur SMS — restera non fait et écrit
comme tel. Le §80 est la règle : **ne jamais déclarer disponible ce qui ne
l'est pas.**
