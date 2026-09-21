# PostgreSQL injoignable ou lent

## Reconnaître

- `/ready` rend 503 ; `/health` rend toujours 200 (le processus vit).
- `npm run check:production` : `postgres — injoignable`.
- Journal : `Can't reach database server`.

## Ce qui n'est pas en danger

Rien ne s'écrit, donc rien ne se corrompt. **Une base injoignable vaut mieux
qu'une base incohérente** — c'est la raison pour laquelle aucune écriture n'est
mise en file d'attente pour « rattraper plus tard » : rejouer des paiements
depuis une file après une panne est le meilleur moyen d'en créer en double.

## Agir

1. Distinguer la base du réseau : `pg_isready -h <hôte>` depuis le conteneur.
2. Si l'hébergeur est en cause, suivre son incident. Communiquer une
   indisponibilité franche plutôt qu'un service à moitié debout.
3. **Ne pas** basculer vers une base vide pour « rétablir le service ». Une
   place de marché sans ses commandes n'est pas rétablie.
4. Au retour : `npm run check:production`, puis `/admin/data-integrity` —
   une coupure en pleine transaction peut laisser des états partiels.

## Lenteur plutôt que panne

Le journal d'accès porte `durationMs` par requête et par route. Comparer les
routes entre elles dit si le problème est global ou localisé. Aucun agrégat
n'existe (pas de collecteur de métriques) : la lecture se fait sur les lignes.
