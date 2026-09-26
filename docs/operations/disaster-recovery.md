# Reprise après sinistre

## Avertissement liminaire

**Il n'existe aujourd'hui aucune sauvegarde.** Ce document décrit donc ce
qu'il faudra faire *quand* il y en aura, et ce qu'on peut faire *sans*. La
distinction est tenue partout : présenter une procédure de restauration alors
que rien n'est sauvegardé donnerait la même impression de sécurité qu'une
vraie sauvegarde, jusqu'au jour où l'on en a besoin.

## RPO et RTO : non décidés

| | Valeur | État |
|---|---|---|
| RPO — perte de données acceptable | à décider | **non décidé** |
| RTO — délai de rétablissement | à décider | **non décidé** |

Ce ne sont pas des paramètres techniques mais des décisions d'exploitation.
Combien de minutes de commandes acceptez-vous de perdre ? En combien de temps
la place de marché doit-elle être rétablie ? Tout le reste en découle : un RPO
de cinq minutes impose l'archivage des journaux de transaction ; un RPO de
vingt-quatre heures se contente d'une copie quotidienne.

Tant qu'ils ne sont pas fixés, le RPO réel est **infini** : tout est perdu.

## Ce qui survit aujourd'hui à quoi

| Composant | Perte | Conséquence réelle |
|---|---|---|
| PostgreSQL | **irréversible** | comptes, commandes, paiements, grand livre, litiges, documents |
| Redis | aucune | non installé ; rien de critique n'en dépendrait (§8) |
| Recherche | aucune | s'exécute en SQL sur PostgreSQL |
| Stockage local des pièces jointes | pièces jointes perdues | disque du conteneur ; un stockage objet le résoudrait |
| Processus applicatif | aucune | sans état ; un redémarrage suffit |
| Prestataire externe | dégradation | voir les fiches d'incident |

La colonne qui compte est la première.

## Scénarios

### 1. Base de données indisponible

**Symptôme** : `/ready` rend 503, `check:production` signale PostgreSQL
injoignable, toutes les écritures échouent.

**Ce qui ne se perd pas** : rien n'est écrit, donc rien n'est corrompu. Une
base injoignable est préférable à une base incohérente.

1. Vérifier que c'est bien la base et non le réseau : `pg_isready` depuis le
   conteneur applicatif.
2. Si l'hébergeur est en cause, suivre son canal d'incident. Ne pas basculer
   vers une base vide « pour rétablir le service » : une place de marché sans
   ses commandes n'est pas un service rétabli, c'est un service qui ment.
3. Une fois revenue : `npm run check:production` avant de rouvrir.

### 2. Base perdue ou corrompue

**Aujourd'hui : irrécupérable.** C'est la raison pour laquelle l'absence de
sauvegarde est le seul point bloquant de `check:production`.

Quand une sauvegarde existera, la procédure sera : arrêter les écritures,
restaurer sur une base **neuve**, faire tourner les contrôles d'intégrité
(`/admin/data-integrity`), comparer les totaux du grand livre, puis rebrancher.
Jamais restaurer par-dessus la base en place.

### 3. Déploiement raté

Les migrations sont additives (§32) et l'entrée s'arrête sur tout échec autre
que P3005 : la base reste intacte et l'ancienne version en place. Redéployer
l'image précédente suffit.

### 4. Prestataire externe défaillant

Voir `playbooks/`. Principe commun : dégrader proprement, **ne jamais simuler
une réussite**.

### 5. Fuite de secret

Voir `playbooks/incident-securite.md`.

## Test de restauration

Une sauvegarde jamais restaurée est un fichier, pas une sauvegarde. Quand la
sauvegarde existera, la restauration devra être éprouvée périodiquement sur
une base jetable, et le résultat vérifié par les contrôles d'intégrité — pas
par un simple « la restauration s'est terminée sans erreur ».
