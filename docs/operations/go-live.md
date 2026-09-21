# Mise en service

Deux scripts, deux questions différentes. Aucun des deux n'affiche de secret,
et un test le vérifie en les exécutant pour de vrai et en fouillant leur
sortie — y compris pour des **extraits**, car un fragment suffit souvent à
retrouver le reste.

## `npm run check:production` (§78)

Répond à : **cette instance peut-elle démarrer et servir ?**

Configuration (présence des variables, jamais leur valeur), dépendances
réellement jointes, dix invariants d'intégrité, état des prestataires, points
non instrumentés.

Code de sortie 0 si rien ne bloque, 1 sinon — ce qui permet de l'enchaîner
dans un déploiement.

**L'absence de sauvegarde y est bloquante**, seule de son espèce : c'est le
seul point dont la conséquence est irréversible. Tout le reste se rattrape ;
une base perdue, non.

Si le contrôle lui-même échoue, il sort en erreur avec cette phrase : *un
contrôle qui ne peut pas s'exécuter ne vaut pas un contrôle réussi*.

## `npm run check:go-live` (§79)

Répond à : **peut-on ouvrir au public sans mentir ?**

Pour chacun des quinze domaines — authentification, catalogue, panier,
commandes, paiement, remboursement, versements, expédition, confiance,
croissance, IA, transfrontalier, notifications, change, administration — il
dit si le domaine est ouvert, et si ce qu'il promet repose sur quelque chose
de réel.

Quatre états : `PRET`, `PARTIEL`, `SIMULATION`, `FERME`. Un domaine en
`SIMULATION` fait sortir le script en erreur : ouvrir au public dans cet état
promettrait à des acheteurs ce que personne ne peut tenir.

### Ce qu'il ne prouve pas, et qui est écrit dans sa propre sortie

Que les parcours fonctionnent. La preuve fonctionnelle est la suite de bout en
bout (`npm run test:e2e`), qui passe des commandes réelles contre une base
réelle.

Un script qui se contenterait de constater que les routes sont montées dirait
« le code existe » — et V24 §72 interdit explicitement d'en conclure quoi que
ce soit.

## État au dernier passage

```
✗ 1 point bloquant   : sauvegardes
! 4 domaines simulés : paiement, remboursement, versements, expédition
```

Ces cinq lignes sont la distance qui reste entre ce dépôt et une ouverture au
public. Aucune ne se comble en écrivant du code.
