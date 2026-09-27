# Sauvegardes et restauration

Ce document existe pour une raison simple : **une sauvegarde qu'on n'a jamais
restaurée n'est pas une sauvegarde**, c'est un fichier. Ce qui suit décrit quoi
sauvegarder, comment, et surtout comment vérifier que ça marche.

---

## Ce qu'il faut sauvegarder, et ce que ça coûte de le perdre

| Élément | Contenu | Perte si absent |
|---|---|---|
| **PostgreSQL** | commandes, paiements, registre comptable, litiges, utilisateurs, géographie | tout — c'est la seule copie de l'histoire de l'argent |
| **Stockage objet** | pièces jointes de la messagerie, **preuves de litige**, documents commerciaux | les pièces sur lesquelles des décisions d'argent ont été prises |
| **Migrations** | `prisma/migrations/` | rien, si le dépôt Git est intact — c'est bien pour cela qu'elles y sont |
| **Variables d'environnement** | secrets, identifiants prestataires | l'accès au service ; à conserver hors dépôt et hors sauvegarde en clair |

Le stockage objet mérite une attention particulière. Les preuves de litige sont
**empreintées** : si un fichier est perdu, l'empreinte reste en base et
l'historique dira qu'une pièce a existé sans qu'on puisse la produire. C'est
mieux qu'un silence, mais cela ne remplace pas la pièce.

---

## Base de données

### Sauvegarde

```bash
# Copie complète, compressée, horodatée.
pg_dump --format=custom --no-owner --no-acl \
  "$DATABASE_URL" \
  > "touma-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

`--format=custom` plutôt que du SQL brut : la restauration peut être partielle
et parallélisée, et le fichier est compressé.

**Fréquence.** Au moins une fois par jour. Une plateforme qui encaisse a besoin
d'un point de reprise plus serré : si la perte acceptable est d'une heure, il
faut activer l'archivage des journaux de transaction (`archive_mode = on`) en
plus des copies quotidiennes.

**Rétention.** Une copie quotidienne gardée 30 jours, une copie mensuelle gardée
12 mois. Un litige peut être ouvert longtemps après la vente.

### Restauration

```bash
createdb touma_restore
pg_restore --dbname=touma_restore --no-owner --jobs=4 touma-<horodatage>.dump
```

Puis, **avant de basculer** :

```bash
DATABASE_URL=postgres://…/touma_restore npx prisma migrate status
```

`migrate status` doit annoncer que toutes les migrations sont appliquées. Si la
copie est plus ancienne que le code déployé, appliquer les migrations
manquantes :

```bash
DATABASE_URL=postgres://…/touma_restore npx prisma migrate deploy
```

### Vérifier que la copie vaut quelque chose

Une restauration qui « ne plante pas » ne prouve rien. Ces quatre contrôles, sur
la base restaurée, disent si elle est utilisable :

```sql
-- 1. La géographie est complète : 23 provinces, sinon le pays est amputé.
SELECT count(*) FROM touma_provinces WHERE "countryCode" = 'TD';

-- 2. Le registre comptable est cohérent avec les commandes payées.
SELECT count(*) FROM touma_ledger_entries;

-- 3. Aucune commande payée sans paiement réussi.
SELECT count(*) FROM touma_orders o
 WHERE o.status = 'PAID'
   AND NOT EXISTS (SELECT 1 FROM touma_payments p
                    WHERE (p."orderId" = o.id OR p."orderGroupId" = o."groupId")
                      AND p.status = 'SUCCEEDED');

-- 4. Aucune preuve de litige sans clé de stockage.
SELECT count(*) FROM touma_dispute_evidence WHERE "storageKey" IS NULL;
```

Le troisième et le quatrième doivent rendre **zéro**. Un résultat non nul
signale soit une copie prise au milieu d'une transaction, soit une divergence
réelle à instruire avant de remettre en service.

**À faire une fois par trimestre, sur une base jetable.** Une équipe qui n'a
jamais restauré découvre ses problèmes le jour où elle n'a pas le choix.

---

## Stockage des fichiers

Deux configurations possibles, selon `TOUMA_STORAGE`.

### Disque local

Les fichiers vivent sous le disque persistant (`/data` sur Render — voir
`docs/touma-mise-en-ligne.md`). **Sans disque persistant, ils disparaissent au
redéploiement suivant**, ce qui est le piège le plus coûteux de cette
plateforme : les factures et les preuves de litige s'évaporent en silence.

```bash
tar --create --gzip --file "touma-files-$(date -u +%Y%m%d).tar.gz" /data/touma
```

### Service compatible S3

Utiliser la réplication du fournisseur (versionnage d'objets + réplication
inter-régions), qui est plus fiable qu'une copie périodique. À défaut :

```bash
aws s3 sync "s3://$S3_BUCKET" ./sauvegarde-fichiers --delete
```

**Activer le versionnage des objets.** Une suppression accidentelle devient
alors réversible, et c'est la seule protection contre un effacement qui ne se
remarque que des semaines plus tard.

---

## Migrations

Les migrations sont **versionnées dans le dépôt** (`prisma/migrations/`), donc
sauvegardées avec le code. Deux règles :

- **Ne jamais modifier une migration déjà appliquée en production.** Corriger,
  c'est ajouter une migration ; réécrire l'histoire fait diverger les
  environnements sans que rien ne le signale.
- **Lire le SQL avant d'appliquer.** `prisma migrate deploy` exécute ce qui est
  écrit ; une migration V16 ouvre par une suppression assumée de données, et
  c'est écrit dans le fichier — ce genre de chose se lit avant, pas après.

---

## Ordre de reprise après incident

1. **Restaurer PostgreSQL** dans une base neuve, et faire passer les quatre
   contrôles ci-dessus.
2. **Restaurer les fichiers**, puis vérifier par sondage que quelques clés de
   stockage tirées de `touma_dispute_evidence` correspondent à des objets qui
   existent réellement.
3. **Appliquer les migrations** manquantes.
4. **Rebrancher les variables d'environnement** — elles ne sont pas dans la
   sauvegarde, et c'est voulu.
5. **Vérifier les sondes** `/health` et `/ready` avant d'ouvrir le trafic.
6. **Prévenir les personnes concernées** si des commandes ou des paiements ont
   été perdus. Une commande disparue en silence est pire qu'une commande
   annulée avec une explication.

---

## Ce que ce document ne couvre pas

- **La sauvegarde des secrets.** Ils n'ont rien à faire dans une sauvegarde en
  clair ; utilisez le gestionnaire de secrets de votre hébergeur.
- **La continuité de service** (bascule automatique, réplique chaude). Cela
  demande une architecture qui n'est pas celle d'aujourd'hui, et l'inventer ici
  donnerait un faux sentiment de sécurité.
- **Les obligations légales de conservation** au Tchad et au Cameroun. Elles
  existent, elles dépendent du statut de l'exploitant, et c'est à un conseil
  juridique de les dire — pas à ce fichier.
