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

## Validation des adresses (V25 §40)

`z.string().url()` s'appuie sur `new URL()`, qui valide la **forme** et ne dit
rien du schéma. Vérifié :

```
javascript:alert(1)                → ACCEPTÉ
data:text/html;base64,PHNjcmlwdD4= → ACCEPTÉ
file:///etc/passwd                 → ACCEPTÉ
vbscript:msgbox(1)                 → ACCEPTÉ
```

Dix champs du domaine l'employaient : image de produit, logo de boutique,
pièce de vérification, preuve de litige, site d'entreprise, source d'une règle
commerciale, retour de paiement.

**Deux finissent dans un `<a href>`.** La source d'un itinéraire de corridor
est rendue ainsi sur la vitrine publique, qui n'a pas de politique de sécurité
de contenu : un `javascript:` s'y serait exécuté dans le navigateur de chaque
visiteur, planté par un administrateur ne disposant que de `ADMIN_TRADE`. Le
découpage des permissions rend ce scénario concret plutôt que théorique.

`urlWeb()` n'accepte que `http:` et `https:`, et refuse les identifiants dans
l'adresse (`https://banque-connue.test@attaquant.test`), qui servent surtout à
déguiser un domaine hostile.

### Retour de paiement

`returnUrl` n'est consommé par aucun prestataire aujourd'hui, mais c'est le
champ qui **deviendra** la cible d'une redirection le jour où un vrai
prestataire sera raccordé — et une redirection ouverte est le moyen le plus
commode de faire atterrir un acheteur sur une fausse page de confirmation.

`TOUMA_PAYMENT_RETURN_ORIGINS` (liste séparée par des virgules) restreint les
origines acceptées. Non configurée, rien n'est bloqué : rien n'est encore
branché. **Elle se configure avant le raccordement, pas après.**

## Pièces jointes (V25 §40-41)

Déjà en place avant V25, vérifié à l'audit : le type est déduit du **contenu**
(signatures de fichiers), jamais de l'en-tête envoyé par le client ; les
contenus exécutables sont refusés ; les URL de téléchargement sont signées
avec comparaison à temps constant ; la taille est bornée.

Les images de produit sont des **adresses externes**, pas des téléversements :
le serveur ne les récupère jamais (vérifié — les deux seuls appels sortants du
domaine visent des points de terminaison configurés). Il n'y a donc pas de
surface SSRF de ce côté.

Aucune analyse antivirale n'existe, et aucune abstraction n'en simule une :
une abstraction qui ne scanne rien mais dont le nom laisse croire le contraire
est pire que son absence.

## Analyse de sécurité en intégration continue (V25 §34)

Un travail `Sécurité des dépendances` exécute :

1. `npm audit --audit-level=low` **informatif** — tout s'affiche ;
2. `npm audit --audit-level=critical` **bloquant** ;
3. recherche de secrets versionnés (clés AWS, clés privées, jetons) — motifs
   étroits à dessein, un détecteur trop large finit ignoré ;
4. vérification qu'aucun `.env` n'est versionné.

Le seuil bloquant est « critique » et non « élevé », et c'est motivé : §34
demande de ne pas bloquer artificiellement sans comprendre la gravité. Une
alerte « élevée » sur un paquet de compilation qui ne traite aucune donnée
d'inconnu arrêterait la chaîne sans rendre personne plus sûr — et devant une
chaîne qui crie pour rien, la première chose qu'on fait est de cesser de
l'écouter.

### Ce que le premier passage a trouvé

| Paquet | Gravité | Traitement |
|---|---|---|
| `next` | **critique**, CVSS 10.0, exécution de code à distance | corrigé : 15.5.4 → 15.5.25 (montée mineure) |
| `ip-address`, `sharp` | élevées | corrigées par `npm audit fix` |
| `postcss` | élevée | **exception documentée** ci-dessous |

Dix vulnérabilités au départ, six après, aucune critique.

### Exception : `postcss`

XSS par `</style>` non échappé lors de la sérialisation CSS. Le correctif
exige Next.js 16, une montée **majeure**.

Gravité réelle ici : PostCSS traite, au moment de la compilation, la feuille
de style **de ce dépôt** — jamais une CSS fournie par un inconnu. Le vecteur
suppose de faire passer du contenu hostile dans le compilateur, ce qui
supposerait déjà un accès en écriture au code source.

Décision : ne pas forcer une montée majeure de Next.js pour cette raison. À
réexaminer lors de la prochaine montée de la vitrine, qui doit être un geste
délibéré et testé.

## En-têtes HTTP (V25 §39, §64)

Mesurés sur les réponses réelles, pas lus dans la configuration.

### API (`src/middleware/security.ts`, Helmet)

`Content-Security-Policy` (sans `unsafe-inline` pour les scripts),
`Strict-Transport-Security: max-age=31536000; includeSubDomains`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`frame-ancestors 'none'`, `Cross-Origin-Opener-Policy` et
`Cross-Origin-Resource-Policy: same-origin`.

### Vitrine — elle n'en émettait **aucun**

C'est pourtant elle qui rend du contenu saisi par des vendeurs — titres,
descriptions, noms de boutique — et des adresses posées par des
administrateurs. Sans politique, un script qui parviendrait à s'y glisser
s'exécuterait sans rien pour l'arrêter.

La politique est désormais posée dans `next.config.mjs`. Elle est plus
permissive que celle de l'API sur un point : Next.js injecte ses données
d'hydratation dans des balises `<script>` en ligne, ce qui impose
`'unsafe-inline'`. C'est une limite du cadre, écrite plutôt que masquée, et
elle n'annule pas le reste.

**`'unsafe-eval'` n'y figure pas**, et c'est délibéré. Le mode développement
de Next.js en a besoin pour son rechargement à chaud, et l'essai en navigateur
le signale bruyamment. Affaiblir la politique **de production** pour une
commodité de développement aurait été le mauvais arbitrage : vérifié sur une
compilation de production, les quatre pages se rendent avec **zéro violation**.

`preload` est volontairement absent de HSTS : l'inscription sur la liste de
préchargement des navigateurs se défait très difficilement, et c'est un
engagement à prendre en connaissance de cause.

### CORS (§38)

**Aucun en-tête CORS n'est émis**, vérifié avec une origine tierce. C'est
l'état le plus sûr, et il est volontaire : l'application web est servie par le
même serveur que l'API, et la vitrine l'appelle depuis son serveur de rendu,
jamais depuis le navigateur. Aucune origine tierce n'a besoin d'accéder à
l'API.

Ajouter une configuration CORS « au cas où » créerait la surface qu'elle
prétend encadrer. Le jour où une application tierce en aura besoin, la liste
blanche s'écrira alors — jamais `*` avec des identifiants.

## Note d'outillage

Playwright, qu'emploie `npm run test:browser`, n'était déclaré dans **aucun**
`package.json` : il était simplement présent dans l'image de développement. Un
`npm audit fix` l'a retiré, et le parcours navigateur a cessé de fonctionner.

Il est désormais déclaré en dépendance de développement de l'espace de travail
`@touma/web`, ce qui le rend reproductible depuis un dépôt neuf sans alourdir
l'image de production — celle-ci installe avec `--workspaces=false`.
