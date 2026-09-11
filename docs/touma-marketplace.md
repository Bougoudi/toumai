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
| Touma Business (B2B) | Fonctionnel | `src/touma/b2b` |
| Après-vente (retours, remboursements) | Fonctionnel | `src/touma/returns`, `src/touma/payments/refund.service.ts` |
| Assistance (tickets) | Fonctionnel | `src/touma/support` |
| Promotions (codes de réduction) | Fonctionnel | `src/touma/promotions` |
| Fidélité | Fonctionnel | `src/touma/loyalty` |
| Documents commerciaux | Fonctionnel | `src/touma/documents` |
| Réputation vendeur | Fonctionnel | `src/touma/reputation` |
| Sourcing fournisseurs | Fonctionnel | `src/touma/sourcing` |
| Import / export de catalogue | Fonctionnel | `src/touma/catalog/import.service.ts` |
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

Cinquante-sept modèles préfixés `Touma` (tables `touma_*`), plus la table `Country` et
l'extension du modèle `User` existant (rôle place de marché, pays, statut).

Domaines : pays et adresses · boutiques et vérification · catégories, produits,
images, variantes, stock · panier · commandes et lignes figées · paiements et
événements · commissions et versements · transporteurs, devis, expéditions,
suivi · avis · litiges, messages, preuves · score de risque et signaux de fraude
· favoris · notifications · jetons de rafraîchissement · requêtes et
recommandations d'IA · journal d'audit · groupes de commande, profils
entreprise, appels d'offres et négociation · conversations et messages ·
demandes de retour, lignes retournées et remboursements · tickets d'assistance ·
codes de réduction et leurs utilisations · comptes et mouvements de fidélité ·
documents commerciaux et leurs séries de numérotation · réputation calculée des
boutiques · sollicitations de fournisseurs sur un appel d'offres.

**Règle absolue : tout montant est un `Decimal(18,4)`.** Aucun `Float` financier.
L'utilitaire `src/touma/lib/money.ts` centralise additions, multiplications,
arrondis par devise et **refuse explicitement toute conversion approximative**
entre devises tant qu'aucun fournisseur de taux officiel n'est raccordé.

---

## 5. Ce qui est garanti par les tests

225 tests automatisés s'exécutent contre une vraie base PostgreSQL
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
- un panier multi-vendeurs est payé **une seule fois** et bascule toutes ses
  sous-commandes, avec une commission par commande et sans doublon ;
- un checkout rejoué après succès retrouve sa commande au lieu de répondre
  « panier vide » ;
- un point relais d'un autre pays que la livraison est refusé ;
- un fournisseur ne voit pas les offres concurrentes, ne répond pas deux fois,
  et une offre acceptée ou expirée ne peut plus être négociée ;
- une conversation n'est lisible que par ses participants, et les pièces jointes
  hors format ou trop lourdes sont rejetées ;
- un acheteur ne peut pas présenter un devis de transport national (moins cher)
  pour une expédition transfrontalière, ni un devis établi pour un colis plus
  léger que sa commande ;
- le prestataire de paiement vient de la configuration du serveur : un
  prestataire imposé dans la requête est ignoré, et un code inconnu lève une
  erreur explicite plutôt que de retomber sur l'adaptateur de démonstration ;
- un retour n'est ouvrable qu'après livraison et dans le délai configuré, son
  montant est **recalculé** à partir des prix payés, et il est impossible de
  retourner plus d'unités que la commande n'en contient ;
- un remboursement ne dépasse jamais le montant validé, ni ce qui a été
  réellement encaissé ; un retour déjà remboursé ne peut pas l'être deux fois ;
  la commission plateforme est contre-passée au prorata ;
- ni l'acheteur ni un tiers ne déclenchent un remboursement : seul le vendeur de
  la boutique concernée ou l'administration ;
- une note interne d'assistance n'apparaît jamais dans la vue du demandeur, et
  la file complète des tickets reste réservée à l'administration ;
- une campagne TOUMA ne réduit pas la commission du vendeur, une promotion de
  vendeur si : la commission est assise sur ce que la boutique encaisse ;
- un code de réduction respecte son minimum d'achat, son plafond, ses limites
  globale et par acheteur, ses pays et ses dates — et ne rend jamais une
  commande négative ;
- un vendeur ne peut pas créer de promotion financée par la plateforme, ni de
  code sur la boutique d'autrui ;
- la remise annoncée avant de commander est exactement celle appliquée ;
- les points de fidélité se gagnent à la livraison (jamais au paiement), une
  seule fois par commande, et sont repris au prorata en cas de remboursement ;
- la facture émane de la **boutique**, le reçu de paiement de **TOUMA** : le
  vendeur ne voit jamais dans ses documents un reçu qu'il n'a pas émis ;
- rejouer un paiement n'émet pas une seconde facture, et deux documents ne
  portent jamais le même numéro ;
- un document est figé : changer le prix d'un produit après coup ne modifie ni
  ses lignes ni ses totaux, et un remboursement produit un **avoir** qui
  référence la facture au lieu de la réécrire ;
- une raison sociale n'apparaît sur un document que si elle a été vérifiée ;
- aucun indicateur de réputation n'est publié tant que le volume minimal de
  commandes livrées n'est pas atteint, et un litige ne fait jamais monter un
  score ;
- la capacité annoncée d'un fournisseur est son stock réel, et un pays n'est
  déclaré desservi que s'il l'a réellement été ;
- seul l'auteur d'un appel d'offres peut y solliciter des fournisseurs, et
  solliciter deux fois le même ne le prévient pas deux fois ;
- une simulation d'import n'écrit rien, une ligne fautive n'emporte pas les
  bonnes, une même référence deux fois dans un fichier est refusée, et l'export
  se réimporte sans créer de doublon ;
- le compteur d'une facette est calculé **sans** le filtre de sa propre
  dimension : choisir un pays ne met pas les autres pays à zéro.

Un test navigateur optionnel (`npm run test:browser`, nécessite Playwright)
rejoue **tout le parcours dans Chromium** — accueil, catalogue et filtres,
recherche, fiche produit, estimation de livraison, inscription, panier, tunnel
de commande en quatre étapes, paiement, suivi, espace vendeur (dont le
graphique des ventes), administration, appels d'offres B2B, messagerie,
expédition puis livraison, demande de retour, acceptation et remboursement,
ouverture d'un ticket d'assistance et réponse de l'équipe, création d'un code de
réduction et son application au paiement, consultation de la facture et du reçu,
rendu du document à l'impression, réputation affichée sur la vitrine et dans
l'espace vendeur, recherche de fournisseurs et sollicitation sur un appel
d'offres, import de catalogue en masse, facettes de recherche — puis vérifie, à
**360, 390, 430, 768, 900, 1024, 1280 et 1440 px** : aucune erreur console, aucun
débordement horizontal, navigation basse et menu latéral fonctionnels.

---

## 4 bis. TOUMA Business — appels d'offres (B2B)

Le commerce B2B africain ne commence pas par une fiche produit, mais par un
besoin : « je recherche 500 kg de cacao au Cameroun ». Le module `src/touma/b2b`
implémente ce parcours de bout en bout :

```
profil entreprise → appel d'offres (RFQ) → offres des fournisseurs →
comparaison → négociation → acceptation → commande → paiement
```

Règles appliquées :

- **une offre par boutique** et par appel d'offres ;
- un fournisseur **ne voit jamais les offres de ses concurrents** — l'acheteur
  seul compare, du moins-disant au plus cher ;
- chaque offre porte un **délai** et une **date de validité** : une offre
  expirée ne peut plus être acceptée ;
- la négociation conserve tout l'historique (messages et contre-propositions) —
  il fait foi en cas de litige. Une contre-proposition **du vendeur** ajuste son
  prix ; celle de l'acheteur reste une demande ;
- l'acceptation crée une **vraie commande** (groupe + sous-commande vendeur)
  payable comme n'importe quelle autre, écarte automatiquement les offres
  concurrentes et attribue l'appel d'offres ;
- les lignes de la commande sont figées depuis l'offre : un accord B2B porte
  souvent sur un lot sur mesure, absent du catalogue.

## 4 ter. Commande multi-vendeurs, adresses africaines et points relais

**Un panier, un paiement, plusieurs vendeurs.** Un `ToumaOrderGroup` porte le
paiement unique de l'acheteur ; chaque boutique reçoit sa sous-commande, avec sa
préparation, son expédition et sa commission. Le succès du paiement bascule
toutes les sous-commandes et enregistre une commission par commande, de façon
idempotente.

**Adresses telles qu'elles existent réellement.** Beaucoup de lieux d'Afrique
centrale n'ont ni rue nommée ni code postal : l'adresse porte donc un
**quartier**, un **point de repère** et des **instructions pour le livreur**.
Les coordonnées GPS sont facultatives et ne sont jamais exposées publiquement.

**Points relais.** Là où la livraison à domicile est peu fiable, le retrait en
point relais est souvent le mode le plus sûr : `ToumaPickupPoint` porte le
quartier, le point de repère et les horaires. Le checkout vérifie que le point
choisi dessert bien le pays de livraison.

## 4 quater. Messagerie

Fils acheteur ↔ vendeur, rattachables à une commande. L'accès repose
entièrement sur la **participation** au fil : aucun identifiant deviné ne donne
accès à quoi que ce soit. Les pièces jointes sont limitées en type (JPEG, PNG,
WebP, PDF), en taille (5 Mo) et en nombre (5 par message).

## 4 quinquies. Retours, remboursements et assistance

Le cycle réel d'un après-vente : **demande de l'acheteur → décision du vendeur →
renvoi du colis → réception → remboursement**. Quatre principes le tiennent.

1. **Le montant n'est jamais fourni par le client.** Il est recalculé à partir
   des instantanés de la commande (prix payé × quantité retournée). Les frais de
   livraison ne sont remboursés que si le tort vient du vendeur *et* si la
   commande est retournée en totalité.
2. **Un retour ne rembourse rien tout seul.** Le remboursement est un acte
   distinct, exécuté par un humain (le vendeur de la boutique concernée ou
   l'administration) via `refundService`, qui appelle réellement l'adaptateur de
   paiement et trace la référence renvoyée.
3. **Deux plafonds simultanés.** Un remboursement ne peut dépasser ni le solde
   remboursable de la commande, ni le montant réellement encaissé par le
   paiement qui la couvre — ce second plafond protège les autres boutiques d'un
   panier multi-vendeurs, payé en une seule fois.
4. **La comptabilité est corrigée, jamais réécrite.** La commission plateforme
   est contre-passée par une ligne négative au prorata du montant remboursé.

Le délai de retour est une **configuration** (`TOUMA_RETURN_WINDOW_DAYS`, 14
jours par défaut), jamais une constante enfouie dans le code.

L'assistance fonctionne en tickets : un demandeur, un fil, une priorité déduite
de la nature du problème (un incident de paiement passe devant), et des **notes
internes** filtrées à la lecture — elles ne quittent jamais l'administration,
quelle que soit l'interface qui interroge l'API.

## 4 sexies. Promotions et fidélité

**Qui finance la remise** structure tout le module. Une campagne TOUMA
(`PLATFORM`) laisse le vendeur payé plein tarif : sa commission reste assise sur
le sous-total avant remise, la plateforme absorbe le coût de sa propre
promotion. Une promotion de boutique (`STORE`) réduit le revenu du vendeur, et
donc la commission qui s'y applique. Chaque sous-commande conserve les deux
montants (`discountTotal` et `sellerFundedDiscount`) : la répartition est
vérifiable après coup, elle n'est pas recalculée à la volée.

Le calcul est une **fonction pure** (`computeDiscount`) partagée par l'aperçu
affiché à l'acheteur et par le checkout : ce qu'il voit est ce qu'il paie. La
remise est répartie entre les boutiques au prorata, la dernière part absorbant
le reste de l'arrondi — aucun centime n'est perdu ni créé.

Les garde-fous sont tous côté serveur : minimum d'achat, plafond de remise,
limite globale (incrémentée de façon **conditionnelle**, comme le stock, pour
que deux paniers simultanés ne la dépassent pas), limite par acheteur, pays de
livraison, dates, réservation à une première commande, et l'interdiction
absolue de rendre une commande négative. Un montant fixe porte obligatoirement
sa devise : l'appliquer à un panier d'une autre devise reviendrait à inventer un
taux de change.

**Fidélité.** Les points se gagnent à la **livraison**, pas au paiement — créditer
au paiement offrirait des points sur des commandes ensuite annulées. Le crédit
est idempotent (une contrainte d'unicité par commande), et un remboursement
reprend les points au prorata. Le solde n'est jamais écrit à la main : il est la
somme des mouvements, et le débit au checkout passe par une mise à jour
conditionnelle qui interdit de dépenser deux fois les mêmes points. Les points
ne traversent pas les devises : faute de taux officiel, ils ne sont gagnés et
dépensés que sur les commandes libellées dans `TOUMA_LOYALTY_CURRENCY`. Taux
d'acquisition, valeur du point, part maximale du panier réglable en points et
paliers sont tous des **réglages**, pas des constantes de code.

## 4 septies. Documents commerciaux

Facture, avoir, reçu de paiement, bon de commande, bon de livraison. Trois
principes les gouvernent.

1. **L'émetteur est celui qui vend.** La facture est émise par la **boutique**
   au nom de l'acheteur ; TOUMA n'émet que le reçu du paiement qu'elle a
   effectivement encaissé, et le bon de commande émane de l'acheteur. Confondre
   ces rôles ferait de la place de marché le vendeur, ce qu'elle n'est pas.
2. **Un document est figé.** Son contenu — parties, lignes, totaux, mentions —
   est copié à l'émission et n'est plus jamais modifié. Une correction passe par
   un avoir qui référence la facture d'origine : on corrige, on ne réécrit pas.
3. **Rien n'est inventé.** Aucune TVA n'est calculée tant qu'aucun régime fiscal
   n'est configuré, et le document le **dit** au lieu d'afficher un montant de
   taxe faux. Même chose pour l'identité légale : la raison sociale d'un vendeur
   n'apparaît que si elle a été vérifiée par TOUMA, et celle de l'exploitant
   seulement si elle est renseignée (`TOUMA_COMPANY_*`).

La numérotation suit une série par émetteur, type et année
(`FAC-2026-A1B2-00001`), avec un compteur incrémenté de façon atomique : deux
factures ne peuvent pas porter le même numéro. L'émission est **idempotente**
par événement source, donc rejouer un webhook de paiement ne produit pas de
doublon.

**Format.** Le document est une page HTML pensée pour l'impression, avec une
feuille de style dédiée : c'est le navigateur qui produit le PDF. Embarquer un
générateur de PDF aurait signifié soit une dépendance lourde, soit un fichier
écrit à la main incapable de rendre correctement les accents français — un
demi-résultat qui aurait mal vieilli.

## 4 octies. Réputation vendeur

Touma Verified contrôle des **pièces** ; la réputation mesure des **faits**.
Les deux sont complémentaires, et aucun des deux ne garantit une transaction —
l'interface le dit explicitement.

Les indicateurs sont tous calculés sur les transactions réelles de la boutique :
taux de livraison dans le délai que le transporteur avait annoncé, délai moyen
de préparation (paiement → expédition) et d'acheminement (expédition →
livraison), taux d'annulation après paiement, taux de litige, taux de retour,
part des conversations où le vendeur a répondu et délai de réponse médian.
Rien n'est saisi à la main, rien n'est estimé.

**Pas d'indicateur sans volume.** En dessous de `TOUMA_REPUTATION_MIN_ORDERS`
commandes livrées, les taux valent `null` et l'interface annonce « pas encore
assez de commandes ». Un « 100 % de livraisons à l'heure » sur deux ventes
tromperait l'acheteur, et c'est exactement le genre de statistique creuse qu'un
vendeur nouvellement inscrit pourrait exhiber.

Le score 0–100 agrège ces composantes avec des **pondérations publiées** (30 %
ponctualité, 25 % note des acheteurs, 20 % absence d'annulation, 15 % absence de
litige et de retour, 10 % réactivité) : un vendeur doit pouvoir comprendre ce
qui le fait monter ou descendre, et l'espace vendeur lui montre le détail
composante par composante. Une composante non mesurable ne pénalise pas — le
score est renormalisé sur ce qui a réellement pu être observé, plutôt que de
compter un zéro qui serait faux.

Le calcul est un **instantané** rafraîchi à la lecture quand il a dépassé sa
durée de validité (`TOUMA_REPUTATION_TTL_SECONDS`). Les événements qui changent
la réputation — livraison, annulation, litige, retour — se contentent de le
marquer périmé : un acheteur qui ouvre un litige n'a pas à attendre un agrégat.

## 4 nonies. Sourcing fournisseurs

Un acheteur en gros ne cherche pas un article : il cherche **qui peut le
fournir**, au bon volume, depuis le bon pays, dans un délai tenable. La
recherche porte donc sur des **boutiques**, pas sur des produits, et croise :
capacité réellement en stock sur les références correspondantes, quantité
minimale de commande, meilleur prix, délai médian annoncé dans ses offres B2B
passées, pays où elle a **réellement** expédié, et sa réputation calculée.

Tout est observé, rien n'est déclaratif : un fournisseur ne peut pas se
prétendre capable de dix tonnes sans les avoir en stock, ni afficher un pays
qu'il n'a jamais servi. Quand une information manque, l'interface le dit
(« n'a pas encore expédié vers ce pays — cela ne veut pas dire qu'il ne peut
pas ») plutôt que de laisser croire à une impossibilité.

Une commande **remboursée** compte quand même comme une expédition réalisée :
le fait que la boutique ait su livrer ce corridor ne s'efface pas parce que
l'acheteur a été remboursé ensuite. Cette règle est la même dans la recherche
et dans la fiche fournisseur — deux modules qui regarderaient les mêmes faits
avec des filtres différents finiraient par se contredire à l'écran.

**Sollicitation.** L'acheteur coche des fournisseurs repérés et les invite sur
l'un de ses appels d'offres ouverts. L'appel d'offres reste visible de tous :
l'invitation ne crée aucun privilège, elle prévient un fournisseur qu'on
l'attend — c'est ainsi qu'un acheteur en gros travaille réellement, il démarche
plutôt que de publier dans le vide. Le fournisseur retrouve ces demandes dans
« Sollicitations reçues ».

## 4 decies. Import et export de catalogue

Un grossiste qui a deux cents références ne les saisira pas une par une : sans
import en masse, il ne met pas son catalogue en ligne et la place de marché
reste vide. C'est un sujet d'**adoption**, pas de confort.

Le format d'entrée est ce qu'un tableur produit réellement, pas un CSV idéal :
guillemets, virgules et retours à la ligne dans les cellules, guillemets
doublés, séparateur point-virgule des Excel francophones, BOM UTF-8, en-têtes
accentués, nombres au format « 12 500,50 ». Les colonnes sont reconnues en
français comme en anglais. L'analyseur est écrit à la main (aucune dépendance)
et couvert par ses tests unitaires.

**Rien n'est écrit avant que le vendeur ait vu le résultat.** L'import se fait
en deux temps : une simulation qui rend un diagnostic ligne par ligne — avec le
numéro de ligne tel que le vendeur le voit dans son tableur — puis
l'application. Un fichier à moitié importé, dont les erreurs se découvrent
après coup, coûte plus cher à réparer qu'à ressaisir.

**Une ligne fautive n'emporte pas les autres.** Chaque ligne est validée
isolément ; l'application n'écrit que les lignes valides et rend la liste exacte
des rejets avec leur motif. L'écriture se fait par transactions courtes, une par
ligne, plutôt qu'en une transaction géante qui verrouillerait la base et
annulerait 499 lignes valides pour une seule en échec.

La devise vient toujours du pays de la boutique : accepter une devise étrangère
dans un fichier reviendrait à inventer un taux de change. La mise à jour se fait
par référence (`sku`), et le stock importé **remplace** le stock connu — c'est
l'inventaire du vendeur qui fait foi, pas une addition à l'aveugle.

L'export a exactement le même format que l'import : exporter, corriger dans son
tableur, réimporter. Sans cet aller-retour, l'import ne servirait qu'une fois.

## 4 undecies. Facettes de recherche

Des filtres sans compteur obligent l'acheteur à deviner : il clique, la liste se
vide, il recommence. Chaque filtre annonce donc **combien de résultats** il
donnerait — par catégorie, par pays, par disponibilité, pour les boutiques
vérifiées, et par tranche de prix.

Le point technique qui fait toute la différence : le compteur d'une dimension
est calculé **sans** le filtre de cette dimension. Sinon, choisir « Cameroun »
mettrait tous les autres pays à zéro et l'acheteur ne pourrait plus changer
d'avis sans tout réinitialiser — c'est le défaut classique des facettes mal
faites. Les autres filtres, eux, s'appliquent bien.

Les tranches de prix sont dérivées des prix **réellement présents** dans les
résultats, arrondies à des bornes lisibles, et les tranches vides ne sont jamais
proposées. Elles n'apparaissent que si les résultats partagent une seule devise :
répartir un panier multi-devises en tranches reviendrait à inventer un taux de
change, et l'interface explique alors comment affiner.

Tous les compteurs viennent d'agrégats en base — aucun n'est estimé.

---

## 5 bis. Interface

L'interface est servie sous `/touma/` par le même serveur. Elle est écrite en
JavaScript standard (modules ES), **sans dépendance ni script en ligne**, ce qui
la rend compatible avec la politique de sécurité du contenu déjà en place.

**Système de design.** `public/touma/tokens.css` est la source unique des
couleurs, espacements, typographies, rayons et ombres — palette TOUMA
(`#0B5D5E`, `#E07A3F`, `#F3EBDD`, `#FAF8F2`, `#172121`). Aucun composant ne code
une valeur en dur. `public/touma/touma.css` construit dessus les composants :
boutons, champs, cartes, badges, statuts, étoiles, tableaux, onglets, étapes,
chronologies, modales, notifications éphémères, squelettes de chargement.

**Mobile d'abord.** En dessous de 900 px : en-tête compact, recherche pleine
largeur, menu latéral, et navigation basse à cinq entrées (Accueil, Catalogue,
Panier, Commandes, Compte). Les cibles tactiles font au moins 44 px.

**Chargement à la demande.** Les espaces vendeur et administration sont chargés
par import dynamique : la visite d'un acheteur ne télécharge pas leur code.

**États.** Chaque page gère chargement (squelettes), vide, erreur et succès, via
des composants partagés (`loadingState`, `emptyState`, `errorState`, toasts,
`confirmDialog`).

**Visuels produit.** Le catalogue de démonstration est illustré par des visuels
SVG servis par l'application (`public/touma/img/`). Un produit sans visuel
affiche un repli graphique, jamais un texte d'attente.

**Référencement.** Chaque page a une URL réelle (`/touma/produits/<slug>`)
servie par le serveur, qui injecte titre, description, Open Graph, URL canonique
et données structurées `schema.org/Product` — voir `src/touma/seo.ts`. Les
espaces privés sont en `noindex`. `sitemap.xml` est généré depuis le catalogue
réel et `robots.txt` exclut les espaces privés.

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
0. Les retours, remboursements et tickets d'assistance (§ 4 quinquies), les
   codes de réduction et la fidélité (§ 4 sexies), les documents commerciaux
   (§ 4 septies), la réputation calculée (§ 4 octies) et le sourcing
   fournisseurs (§ 4 nonies) sont livrés.
0. **Fiscalité** : aucun régime de TVA n'est configuré ; les documents l'annoncent
   explicitement plutôt que d'afficher une taxe inventée. Brancher un régime réel
   (taux par pays, exonérations, seuils) est un chantier à part, à mener avec un
   conseil fiscal local.
0. **Monorepo `apps/` + `packages/` (Next.js / NestJS)** : non réalisé. Le
   domaine est déjà découpé en modules autonomes (`src/touma/<module>` avec son
   routeur, son service et ses adaptateurs), ce qui rend l'extraction mécanique ;
   mais migrer un produit en service vers un monorepo Next.js/NestJS est un
   chantier à part entière, qui aurait produit des écrans vides plutôt qu'un
   parcours d'achat fonctionnel. À traiter comme une phase dédiée, module par
   module, en conservant la base de données et les contrats actuels.
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
