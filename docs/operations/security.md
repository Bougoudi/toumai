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
