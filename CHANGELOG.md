# Journal des changements

## Comment ce fichier est fait

Il commence à **V25**, parce que c'est la première version dont le détail a
été consigné au fil du travail. Les versions antérieures sont reconstituées à
partir de ce que le dépôt prouve — les migrations de schéma et les documents
d'audit versionnés — et non d'un journal qui n'a jamais existé. La distinction
est marquée : écrire des notes de version autoritaires pour un travail qu'on
n'a pas suivi produit un document qui a l'air fiable et ne l'est pas.

Chaque entrée sépare ce que §76 demande : fonctionnalités, corrections,
changements de base, ruptures, sécurité.

## Versions

Avant `1.0.0`, **aucune stabilité d'API n'est promise**. La version mineure
suit le palier de travail (V25 → `0.25.0`) ; le correctif compte les
livraisons intermédiaires. `1.0.0` marquera la première mise en service
réelle — elle suppose les prestataires raccordés et les sauvegardes en place,
ce qui n'est pas le cas aujourd'hui.

---

## [0.25.0] — Infrastructure, fiabilité et exploitation

### Sécurité

- **Exécution de code à distance corrigée** (CVSS 10.0) : Next.js 15.5.4 →
  15.5.25, dépendance directe de la vitrine publique. `npm audit` n'avait
  jamais été exécuté sur ce dépôt ; dix vulnérabilités trouvées, six restantes,
  aucune critique.
- **Signature des webhooks de paiement** vérifiée sur les octets reçus. Elle
  l'était sur une re-sérialisation du corps analysé : toutes les notifications
  d'un prestataire réel auraient été rejetées comme falsifiées, et ses
  paiements seraient restés non confirmés.
- **Validation des adresses** : `z.string().url()` acceptait `javascript:`,
  `data:text/html`, `file://` sur dix champs, dont deux rendus en `<a href>`
  sur une vitrine sans politique de sécurité de contenu.
- **Permissions d'administration granulaires** (9), console découpée route par
  route. Nommer quelqu'un administrateur ne lui donne plus aucun droit.
- **Limites de débit par compte** et non plus par adresse seule ; compteurs
  séparés pour paiement, remboursement, coupons, IA, messagerie.
- **En-têtes de sécurité sur la vitrine**, qui n'en émettait aucun.
- **Conteneur exécuté sans privilège** (`USER node`).
- Garde-fou de démarrage étendu : `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `TOUMA_PAYMENT_WEBHOOK_SECRET` et `DATABASE_URL` sont contrôlés.
- Analyse de sécurité en intégration continue : audit des dépendances,
  recherche de secrets versionnés.

### Fonctionnalités

- Sessions actives et révocation par appareil (`/auth/me/sessions`).
- Export des données personnelles et suppression de compte différée, par
  anonymisation — les faits commerciaux et comptables sont conservés.
- Drapeaux de fonctionnalité avec ciblage et déploiement progressif à
  attribution **stable**.
- Centre d'opérations : santé réelle des services, ce qui n'est pas mesuré
  marqué comme tel.
- Contrôles d'intégrité : dix invariants exprimés en SQL.
- Identifiant de requête propagé jusqu'au code métier, journal d'accès
  structuré, codes d'erreur.
- Deux contrôles exécutables : `check:production` et `check:go-live`.
- **Vitrine publique bilingue français / arabe** (§62). L'application était
  bilingue depuis V17 ; la vitrine — la seule des deux qu'un inconnu rencontre,
  celle que renvoie un moteur de recherche — ne l'était pas. L'arabe vit sous
  `/ar/…` ; les adresses françaises ne bougent pas, et les deux versions se
  déclarent l'une l'autre par `hreflang`. Le plan du site liste les deux.
- Noms de pays en arabe pour les pays configurés, avec repli sur le nom fourni
  par le serveur plutôt qu'une translittération fabriquée.

### Corrections

- Réservation de stock : trois chemins de libération sans plancher laissaient
  `reserved` passer sous zéro. Sans effet sur la disponibilité — elle se
  calcule sur `quantity` — mais le compteur de suivi était faussé.
- Repli `prisma db push` au démarrage du conteneur, déclenché par **tout**
  échec de migration, réservé au seul code P3005 et soumis à autorisation.
- Trois faux positifs dans les contrôles d'intégrité, dont un signalant
  9 104 paiements sur 9 117 comme orphelins : les paiements se rattachent au
  groupe de commandes, pas à la commande.
- Motifs de blocage d'un corridor : `capability.missing` était une liste de
  phrases françaises fabriquées côté serveur. Deux conséquences. D'abord, une
  page arabe affichait en français la raison pour laquelle un corridor ne
  fonctionnait pas — son lecteur voyait qu'il était fermé sans pouvoir lire
  pourquoi. Ensuite, `updateCorridor` décidait si un motif empêchait
  l'activation en cherchant « n'est pas encore ouvert » dans la phrase :
  reformuler ce message, ou seulement changer d'apostrophe, aurait rendu
  bloquant un motif qui ne l'est pas. Le champ `blockers` porte désormais des
  codes ; `missing` en reste le rendu français, inchangé pour les clients
  existants.

### Base de données

Trois migrations, toutes **additives** : `touma_v25_admin_permissions`,
`touma_v25_account_deletion`, `touma_v25_feature_flags`. Aucune colonne
supprimée, aucun défaut modifiant le comportement des versions déployées.

### Ruptures

Aucune. Les réponses d'erreur portent désormais `code` et `requestId` en plus
d'`error`, conservé pour ne rien casser.

### Non fait, et su

Sauvegardes, files d'attente, métriques, alertes, recherche externe : les
composants correspondants ne sont pas installés. `check:production` rend
l'absence de sauvegarde **bloquante**.

---

## [0.24.0] — Commerce transfrontalier

Corridors avec capacité **recalculée** plutôt que déclarée, éligibilité,
documents commerciaux, estimation de coûts sans montant inventé, taux de
change sans source fictive, pages publiques indexées uniquement quand le
corridor fonctionne réellement, recherche par pays d'expédition, pays du
vendeur, origine déclarée et destination atteignable.

Base : `touma_v24_trade`, `touma_v24_cost_confidence`.

## [0.23.0] — Assistance et intelligence

Passerelle IA avec repli déterministe qui refuse d'inventer, outils d'agent
héritant des droits de l'appelant, aperçus de prix et de demande refusant de
publier un taux sans volume suffisant.

Base : `touma_v23_intelligence`.

## [0.22.0] — Croissance

Promotions, fidélité, parrainage, segments, ventes flash avec réservation
concurrente sûre.

Base : `touma_v22_growth`, `touma_v22_loyalty_referral_segments`,
`touma_v22_flash_sales`.

## [0.21.0] — Confiance

Réputation, signalements, appels, évaluation de risque sans variable servant
de substitut à la confiance personnelle.

Base : `touma_v21_trust`.

## [0.20.0] — Finance

Grand livre, règlements, idempotence, traçabilité des webhooks, règles de
commission versionnées.

Base : `touma_v20_finance`, `touma_v20_idempotency`, `touma_v20_settlement`,
`touma_v20_webhook_deliveries`, `touma_v20_commission_rules`.

## [0.17.0] — Tchad national

Géographie administrative (source GeoNames), paiement à la livraison, code de
retrait, zones de livraison, zones de service par boutique.

Base : cinq migrations `touma_v17_*`.

## [0.14.0] – [0.16.0] — Messagerie, exécution, confiance et sécurité

Base : `touma_v14_messaging`, `touma_v15_fulfilment`, `touma_v16_trust`.

## [0.1.0] – [0.13.0] — Socle

Catalogue, panier, commandes, B2B et multi-vendeurs, retours et
remboursements, coupons et fidélité, documents, réputation, appels d'offres,
journalisation des recherches.

Base : `init` puis neuf migrations.

---

Le détail des versions antérieures à V25 vit dans les documents d'audit
versionnés à la racine (`TOUMA-V14-AUDIT.md` et suivants) et dans `docs/`.
