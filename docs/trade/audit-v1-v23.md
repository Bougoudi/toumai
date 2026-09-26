# V24 — audit de l'existant (V1 → V23)

Fait avant d'écrire une ligne. Résultat principal : **une bonne part du
transfrontalier est déjà là**, dispersée, et V24 doit l'assembler plutôt que
la refaire.

## 1. Ce qui existe déjà et ne sera pas dupliqué

| Besoin V24 | Déjà présent | Où |
|---|---|---|
| Commande transfrontalière | `crossBorder`, `buyerCountry`, `sellerCountry` | `ToumaOrder`, posés au checkout |
| Groupe transfrontalier | `crossBorder` | `ToumaOrderGroup` |
| **Découpage multi-vendeur** | le checkout crée **une commande par boutique** | `checkout.service.ts` |
| Origine / destination d'expédition | `originCountry`, `destinationCountry` | `ToumaShippingQuote`, `ToumaShipment` |
| Pays desservis par transporteur | `countries` (liste) | `ToumaShippingProvider` |
| Délai annoncé | `etaMinDays`, `etaMaxDays` | devis et expédition |
| **Adresse africaine** | province, département, sous-préfecture, localité, quartier, point de repère ; code postal **facultatif** | `ToumaAddress` |
| Indicatif téléphonique | `dialCode` | `Country` |
| Stockage privé + URL signée | S3 avec signature et expiration | `messaging/s3-storage.ts`, `disputes/evidence.service.ts` |
| Grand livre et règlement | écritures, soldes, allocation | `finance/ledger.ts`, `settlement.service.ts` |
| Documents | facture, avoir, reçu, bon de commande, bon de livraison | `documents/` |
| Confiance vendeur | score, ventilation, rédaction publique | `trust/` (V21) |
| File de revue de fraude | rapprochement de signaux | `ai/insights/risk.service.ts` (V23) |

§63 (modèle d'adresse africain) et §30 (découpage multi-vendeur) sont donc
**déjà satisfaits**. Les redemander produirait un second modèle d'adresse et un
second découpage, avec leurs propres oublis.

## 2. Ce qui manque entièrement

Aucune trace, nulle part, de : corridor, configuration commerciale d'un pays,
**taux de change**, document commercial (facture commerciale, proforma, liste
de colisage, certificat d'origine), moteur d'éligibilité, versionnage de règle,
attribution de source, coût rendu, chronologie commerciale, machine d'état
commerciale, exception d'expédition.

Le point le plus net : **il n'existe aucune notion de taux de change dans tout
le dépôt**. C'est cohérent avec V20, qui interdit les taux fictifs et impose
de ne jamais additionner deux devises — l'absence était la seule position
tenable tant qu'aucune source n'était branchée. V24 crée l'abstraction, et
elle rend « indisponible » tant qu'aucune source réelle n'est configurée.

## 3. Défauts trouvés

**`ToumaProduct.countryCode` confond deux faits.** Son commentaire dit « pays
d'origine / d'expédition ». Ce sont deux choses : un savon fabriqué au Nigeria
peut être expédié depuis N'Djamena par un revendeur tchadien. Le champ est
employé partout comme **origine d'expédition** — c'est lui que la logistique
lit. §10 et §11 exigent de distinguer les deux, et §11 impose que l'origine
non vérifiée soit `DECLARED`, jamais `VERIFIED`.

Corrigé sans rien casser : `countryCode` garde son sens d'expédition, son
commentaire est rectifié, et l'origine déclarée devient un ensemble de champs
distincts.

**`ToumaShippingProvider.countries` est une chaîne à virgules.** Elle suffit
pour un pays desservi, pas pour un corridor : « dessert TD » et « achemine de
TD vers CM » ne sont pas la même capacité. La chaîne reste ; la capacité de
corridor est portée séparément.

**Aucun défaut bloquant n'a été trouvé.** Le commerce national tchadien n'est
donc touché par rien de ce qui suit, et un test de non-régression le vérifie.

## 4. Conséquence sur l'architecture de V24

Le transfrontalier n'est pas une seconde application posée à côté. C'est une
**couche de configuration et de vérification** au-dessus de ce qui existe :

- le corridor et la configuration pays disent **ce qui est possible** ;
- l'éligibilité confronte une commande envisagée à cette configuration ;
- les documents, les coûts et la chronologie s'accrochent à la commande
  existante ;
- le paiement, l'expédition, le grand livre et le règlement restent **seuls
  maîtres** de leur domaine. V24 les lit, ne les pilote pas.

Un corridor n'est jamais « actif » parce que le code existe : il l'est quand
un prestataire de paiement et un transporteur réels le couvrent, et le moteur
le vérifie au lieu de le supposer.
