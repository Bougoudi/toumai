# Un déploiement a cassé quelque chose

## Ce qui protège déjà

- Les migrations sont **additives** : aucune colonne supprimée, aucun défaut
  qui change le comportement de la version précédente.
- L'entrée du conteneur **s'arrête** sur tout échec de migration autre que
  P3005. Une base momentanément injoignable ne déclenche plus d'alignement
  automatique du schéma.

Conséquence : l'ancienne image fonctionne encore sur la base migrée.

## Agir

1. Redéployer l'image précédente. Ne pas « défaire » la migration : une
   migration additive ne gêne pas l'ancienne version.
2. `npm run check:production` sur l'instance rétablie.
3. `/admin/data-integrity` : une version fautive a pu écrire des états
   incohérents pendant qu'elle tournait.

## Stratégie réellement supportée

Remplacement simple du conteneur. Ni bleu/vert, ni canari : ils supposent une
infrastructure qui n'existe pas ici. Le retour arrière est donc un
redéploiement, avec l'interruption que cela implique.

## Si la migration elle-même est en cause

C'est le seul cas qui demande une intervention en base, et il demande une
sauvegarde vérifiée au préalable. Voir `../disaster-recovery.md` — qui rappelle
qu'aujourd'hui, il n'y en a pas.
