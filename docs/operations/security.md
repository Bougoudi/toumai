# Sécurité d'exploitation

## Permissions d'administration (V25 §25-26)

« Administrateur » était un interrupteur : qui l'était pouvait rembourser un
paiement, ajuster le grand livre, activer un corridor, suspendre un vendeur et
lire les conversations d'IA. Tenable à deux personnes, intenable ensuite — le
jour où quelqu'un est recruté pour traiter les litiges, on lui donne aussi les
paiements sans le vouloir.

### Les neuf permissions

| Permission | Portée |
|---|---|
| `ADMIN_USERS` | comptes, boutiques, produits : consultation, suspension, rôles |
| `ADMIN_PAYMENTS` | paiements, remboursements, webhooks |
| `ADMIN_PAYOUTS` | versements, grand livre, règles de commission |
| `ADMIN_TRADE` | corridors, règles transfrontalières, documents |
| `ADMIN_TRUST` | vérifications, litiges, risque |
| `ADMIN_LOGISTICS` | commandes, expéditions, zones, points relais |
| `ADMIN_AI` | prestataires, invites, journaux d'assistance |
| `ADMIN_MARKETING` | promotions, fidélité, campagnes |
| `ADMIN_SYSTEM` | configuration, permissions, journal d'audit, intégrité |

`requireAdmin` reste la première barrière ; la permission affine. La console
historique, qui mêle les métiers, est découpée **route par route** : une
permission unique pour l'ensemble aurait rendu le découpage décoratif.

### Deux champs, et pourquoi

Un tableau de permissions vide est ambigu : « aucun droit » ou « droits jamais
définis » ? Les confondre mène à l'un des deux accidents — tous les
administrateurs en place perdent l'accès au déploiement, ou un nouvel
administrateur sans permission les obtient toutes en silence.

- `adminScoped = false` : compte antérieur au découpage. **Accès complet**,
  signalé comme tel dans `/admin/permissions` (`effective` porte la liste
  réelle, pas un tableau vide trompeur).
- `adminScoped = true` : seules les permissions listées s'appliquent.

Accorder une permission bascule le drapeau définitivement. L'accès complet
hérité ne se crée jamais à neuf : nommer quelqu'un administrateur via
`PATCH /admin/users/:id/role` le cadre d'emblée **sans aucune permission**, et
la réponse le dit.

La migration est purement additive (`ALTER TABLE … ADD COLUMN … DEFAULT`),
conforme à §32 : aucune colonne supprimée, aucun défaut qui change le
comportement des versions déployées.

### Ce que le découpage ne fait pas

Il ne rejoue pas l'historique : les administrateurs existants restent non
cadrés tant que personne ne leur attribue de permissions. C'est un choix de
sûreté au déploiement, et **une dette** : tant que des comptes non cadrés
subsistent, le cloisonnement est partiel. `/admin/permissions` les liste, et
c'est une action d'exploitation à mener, pas un réglage qui se fait tout seul.

### Traçabilité

Toute attribution est auditée avec l'acteur, la cible, l'état avant et après.
Personne ne peut se retirer `ADMIN_SYSTEM` à soi-même : c'est la seule
permission qui permet de réattribuer les permissions, et se la retirer en
dernier détenteur fermerait la porte de l'intérieur sans clé.

## Limites de débit (V25 §22-23)

### La clé est le compte, pas l'adresse

Les limites ne comptaient que par adresse IP. Deux défauts, tous deux du
mauvais côté :

- **une IP partagée punit tout le monde** — cybercafé de N'Djamena, connexion
  partagée, opérateur mobile derrière une passerelle : un seul abuseur ferme
  la porte aux autres, qui ne comprennent pas pourquoi ;
- **un compte change d'IP quand il veut**, donc une limite par IP n'arrête pas
  ce qu'elle vise.

La clé est désormais le compte quand la requête est authentifiée, l'adresse
sinon (via `ipKeyGenerator`, sans quoi un préfixe IPv6 donnerait des
milliards de clés à un seul abonné, c'est-à-dire aucune limite).

**Une exception, délibérée** : l'anti-force brute sur la connexion reste
compté par adresse. Au moment où cette limite sert, l'attaquant n'est
précisément pas authentifié ; une clé par compte ne compterait rien. Elle
porte donc le défaut de l'IP partagée, et c'est le prix pour que deviner des
mots de passe reste coûteux.

### Compteurs séparés

| Usage | Défaut | Variable |
|---|---|---|
| API globale | 300 / min | `TOUMA_API_RATE_LIMIT` |
| Connexion, inscription | 10 / 15 min | `TOUMA_AUTH_RATE_LIMIT` |
| Paiement, remboursement | 10 / min | `TOUMA_PAYMENT_RATE_LIMIT` |
| Essai de code promotionnel | 20 / 10 min | `TOUMA_COUPON_RATE_LIMIT` |
| Assistance IA | 20 / min | `TOUMA_AI_RATE_LIMIT` |
| Messagerie | 30 / min | `TOUMA_MESSAGING_RATE_LIMIT` |

Chaque usage a son seau : partager un compteur entre le paiement et la
messagerie ferait qu'une conversation animée empêcherait de payer.

Une valeur d'environnement illisible retombe sur le défaut. `limit: NaN`
désactiverait la protection en silence — la pire issue pour une faute de
frappe.

Le dépassement rend le même format que toute autre erreur :
`{ error, code: 'SYSTEM_RATE_LIMITED', requestId }`. Sans cela, c'était la
seule erreur qu'un client ne pouvait pas traiter comme les autres, et la seule
introuvable dans le journal.

### Limite connue : les compteurs sont en mémoire

`express-rate-limit` stocke ses compteurs **dans le processus**. Avec
plusieurs instances derrière un répartiteur, la limite effective est
multipliée par leur nombre. Un magasin partagé demanderait Redis, qui n'est
pas installé.

Ce n'est pas un détail à passer sous silence : sur une seule instance — la
configuration actuelle — les valeurs ci-dessus sont exactes ; à plusieurs,
elles ne le sont plus.

### Éprouvé

La limitation est neutralisée dans la suite de tests, sauf pour le fichier qui
l'exerce (`TOUMA_RATE_LIMIT_IN_TESTS=true`). Une protection qu'aucun test ne
peut exercer est une protection dont personne ne sait si elle marche.
