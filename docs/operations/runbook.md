# Runbook d'exploitation

Ce document décrit ce qui existe réellement. Les procédures qui supposent une
infrastructure non encore fournie sont marquées **À FOURNIR** et nommées
précisément : une procédure présentée comme disponible alors qu'elle ne l'est
pas est pire que pas de procédure du tout, parce qu'on compte dessus le jour où
tout va mal.

## Ce qui tourne réellement

| Composant | État | Remarque |
|---|---|---|
| API Express + PostgreSQL | réel | source de vérité |
| Vitrine Next.js | réelle | déployée séparément |
| Redis | **absent** | aucun client Redis n'est installé ; la sonde `/ready` fait un PING TCP si `REDIS_URL` est défini |
| OpenSearch | **absent** | la recherche s'exécute en SQL sur PostgreSQL |
| File d'attente (BullMQ…) | **absente** | les tâches périodiques passent par `node-cron`, en processus |
| Stockage objet S3 | optionnel | local sous `var/` si non configuré |
| Prestataire de paiement réel | **non raccordé** | adaptateur de simulation uniquement |
| Transporteur réel | **non raccordé** | adaptateur de simulation uniquement |
| Sauvegardes | **À FOURNIR** | voir `backups.md` |
| Supervision / alertes | **À FOURNIR** | aucun collecteur de métriques installé |

## Démarrage en production

Le serveur **refuse de démarrer** si la configuration n'est pas sûre
(`src/config/production-guard.ts`) :

- `JWT_SECRET` et `ENCRYPTION_KEY` absents, trop courts (< 32) ou égaux à une
  valeur de développement publiée ;
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOUMA_PAYMENT_WEBHOOK_SECRET`
  **présents mais faibles** (absents, ils héritent de `JWT_SECRET`, déjà contrôlé) ;
- `DATABASE_URL` absent ou non PostgreSQL.

Aucune valeur de secret n'apparaît dans le message de refus.

`TOUMA_PAYMENT_WEBHOOK_SECRET` non défini produit un avertissement : la clé des
jetons sert alors aussi à vérifier les webhooks. Les deux restent côté serveur,
mais une clé par usage est préférable.

## Migrations de base de données

L'entrée de conteneur exécute `prisma migrate deploy`.

**En cas d'échec, elle s'arrête.** Un seul repli existe, pour le code **P3005**
(base créée avant l'introduction des migrations), et il doit être autorisé
explicitement :

```
TOUMA_ALLOW_BASELINE=true
```

Avant de l'activer : prendre une sauvegarde **et la vérifier** (voir
`backups.md`). Ce repli exécute `prisma db push`, qui aligne la base sur le
schéma du code sans relecture de migration.

Auparavant, ce repli se déclenchait sur *n'importe quel* échec — y compris une
base momentanément injoignable. Ce n'est plus le cas.

## Webhooks de paiement

Le routeur des webhooks doit rester monté **avant tout analyseur de corps**
(`src/app.ts`). Monté après `express.json()`, la signature est vérifiée sur une
re-sérialisation du corps analysé : les octets diffèrent de ceux que le
prestataire a signés, et **toutes** ses notifications sont rejetées comme
falsifiées — les paiements restent alors non confirmés, sans que rien ne
ressemble à une panne.

Le routeur refuse désormais explicitement un corps déjà analysé plutôt que de
le re-sérialiser en silence. Un test (`tests/integration/webhooks.test.ts`)
signe un corps espacé et échoue si l'ordre de montage régresse.

## Exécution du conteneur

L'application tourne sous l'utilisateur `node`, sans privilège. `var/` lui
appartient : c'est là que vont les pièces jointes quand aucun stockage objet
n'est configuré.

## Procédures encore à écrire

Elles le seront au fur et à mesure, et ne sont pas listées comme disponibles :
retour arrière de déploiement, restauration de sauvegarde, reprise de file,
réindexation, purge de cache, coupure de fonctionnalité.
