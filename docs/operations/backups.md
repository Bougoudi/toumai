# Sauvegardes

## État réel : aucune sauvegarde n'est en place

Il n'existe aujourd'hui **aucune sauvegarde automatique** de la base
PostgreSQL de TOUMA dans ce dépôt : ni tâche planifiée, ni script, ni
configuration d'hébergeur versionnée ici.

C'est écrit noir sur blanc parce que la tentation inverse est forte. Une page
de documentation décrivant une belle stratégie de sauvegarde qui n'est branchée
nulle part donne exactement la même impression de sécurité qu'une vraie
sauvegarde — jusqu'au jour où on en a besoin.

## Ce que cela implique

À ce stade, une perte de la base PostgreSQL est une **perte définitive** :
comptes, commandes, paiements, grand livre, litiges, documents commerciaux.

C'est un bloqueur de mise en production, pas une amélioration souhaitable.

## Ce qu'il faut fournir

La sauvegarde dépend de l'hébergement retenu, qui n'est pas décidé :

- **PostgreSQL géré** (Render, Neon, RDS, Cloud SQL) : les sauvegardes
  quotidiennes et la restauration à un instant donné sont une option à activer
  et à configurer chez l'hébergeur. C'est la voie la plus courte.
- **PostgreSQL auto-hébergé** : `pg_dump` quotidien chiffré vers un stockage
  objet distinct de la base, plus archivage WAL si une restauration à la minute
  est exigée.

Dans les deux cas, trois décisions vous reviennent et conditionnent le reste :

| Décision | Question |
|---|---|
| RPO | combien de minutes de commandes acceptez-vous de perdre ? |
| RTO | en combien de temps la place de marché doit-elle être rétablie ? |
| Rétention | combien de temps garder les sauvegardes, et sous quelle obligation légale tchadienne ? |

## Une sauvegarde non testée n'est pas une sauvegarde

Quand une sauvegarde existera, la restauration devra être **éprouvée
périodiquement** sur une base jetable, et le résultat vérifié par des contrôles
d'intégrité (cohérence du grand livre, commandes sans paiement, stocks
négatifs). Tant que personne n'a restauré, personne ne sait si la sauvegarde
est lisible.
