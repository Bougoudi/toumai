# Le monorepo TOUMA : où on en est, et pourquoi

Les prompts d'origine demandaient une architecture `apps/` + `packages/` avec
Next.js et NestJS. Ce document dit ce qui existe aujourd'hui, ce qui a été fait
en connaissance de cause, et ce qui reste — avec les raisons, pour que la
prochaine décision soit prise les yeux ouverts.

## L'état actuel

```
toumai/
├── src/                    API + application existantes (Express, Prisma)  ← la production
├── public/touma/           Application authentifiée (modules ES, installable)
├── packages/
│   └── contracts/          Formes des réponses de l'API — types purs, zéro dépendance
└── apps/
    └── web/                Vitrine publique rendue côté serveur (Next.js 15)
```

Espaces de travail npm. Une seule installation à la racine, un seul
`package-lock.json`.

## Ce qui a été fait, et ce que ça apporte vraiment

### `packages/contracts` — une seule description de l'API

Une interface et un serveur qui décrivent séparément la même réponse finissent
toujours par ne plus décrire la même chose, et personne ne s'en aperçoit avant
l'écran blanc. Le paquet ne contient que des types : il disparaît à la
compilation et n'ajoute pas un octet au navigateur.

Il n'est pas décoratif : `tests/integration/contracts.test.ts` interroge l'API
réelle et vérifie que chaque champ promis est présent, du bon type — et qu'**aucun
montant n'arrive en nombre**. C'est la règle qui justifie le type `MoneyString` :
le serveur calcule en décimal exact et transmet du texte ; une interface qui
reconvertit en `number` pour additionner réintroduit le défaut que la base a
justement évité.

### `apps/web` — la vitrine, pas l'application

Next.js prend en charge **les pages que des inconnus et les moteurs de recherche
consultent** : accueil, catalogue, fiche produit. Rien d'autre.

Ce que ça change, concrètement : le catalogue arrive **écrit dans le HTML**. Sur
un réseau mobile d'Afrique centrale, la page est lisible avant que le moindre
script ne s'exécute. Et le titre et la description d'un produit sont dans la
réponse du serveur, pas injectés après coup — c'est ce que Google indexe.

Ce qu'elle ne fait pas, et ne fera pas : le panier, le paiement, la messagerie,
la négociation, les espaces vendeur et administration. Tout cela demande une
session et vit dans l'application existante, vers laquelle la vitrine renvoie par
des liens. **Dupliquer un tunnel d'achat, c'est se condamner à corriger chaque
défaut deux fois** — et à en oublier un.

La dette assumée : les jetons de couleur sont recopiés dans
`apps/web/app/globals.css`. L'étape suivante est de les extraire en paquet
partagé ; tant que les deux interfaces ne les tiennent pas du même endroit, une
divergence est possible. Autant l'écrire que la découvrir.

## NestJS : pourquoi l'API n'a pas été réécrite

C'est la partie du plan d'origine qui n'a pas été faite, et c'est un choix, pas
un oubli.

L'API compte 125 chemins, une soixantaine de modèles et 336 tests qui passent.
La réécrire en NestJS ne lui ajouterait **aucune fonctionnalité** : elle est déjà
organisée en modules autonomes — un service, un routeur, un schéma de validation
par domaine — ce que Nest apporterait par ses décorateurs. On échangerait une
structure qui fonctionne contre la même structure, exprimée autrement, au prix
d'une semaine de travail et d'un risque de régression sur du code qui touche à
l'argent : commissions, remboursements, plafonds, idempotence.

Une réécriture se justifie quand elle lève une contrainte. Ici, aucune n'est
levée. Les raisons qui la justifieraient un jour, et qu'il faudra vérifier
plutôt que supposer :

- **plusieurs équipes** travaillent sur le même code et ont besoin d'une
  structure imposée plutôt que convenue ;
- **l'injection de dépendances** devient nécessaire pour tester des services
  qui se sont mis à dépendre les uns des autres ;
- **des files de traitement ou du gRPC** entrent dans le produit, là où Nest a
  des intégrations mûres.

## Si la migration doit se faire : dans quel ordre

Jamais d'un bloc. La méthode qui ne casse rien est celle de l'étranglement :
Nest prend un module à la fois, derrière la même URL, pendant que le reste
continue de tourner.

1. **Extraire les jetons de design** en paquet partagé. Petit, sans risque, et
   supprime la seule duplication actuelle.
2. **Monter Nest à côté d'Express**, sur les mêmes ports, et lui confier
   **un seul module** sans enjeu financier — le référentiel des pays, par
   exemple. Les tests d'intégration existants deviennent le juge : ils ne
   doivent pas changer d'une ligne.
3. **Déplacer les modules de lecture** (catalogue, boutiques, recherche), qui ne
   modifient rien et où une erreur est visible immédiatement.
4. **Ne déplacer les modules d'argent qu'en dernier** — paiements, commandes,
   retours, commissions — et un par un, chacun avec sa migration de tests.
5. **Supprimer Express** seulement quand plus rien ne passe par lui.

À chaque étape, la règle est la même : la suite de tests actuelle doit rester
verte sans être réécrite. Le jour où il faut modifier un test pour faire passer
une migration, c'est que la migration a changé un comportement.

## Commandes

```bash
npm install                              # installe la racine et tous les espaces de travail
npm run dev                              # API + application authentifiée (port 3000)
npm run dev --workspace @touma/web       # vitrine Next.js (port 3001)
npm run build --workspace @touma/web     # compilation de la vitrine
npm run typecheck --workspace @touma/web
```

La vitrine lit trois adresses :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `TOUMA_API_URL` | API lue au rendu | `http://127.0.0.1:3000` |
| `TOUMA_APP_URL` | application authentifiée, vers laquelle pointent « Commander », « Mon compte » | `TOUMA_API_URL` |
| `TOUMA_SITE_URL` | la vitrine elle-même : URL canoniques, plan du site, données structurées | `TOUMA_APP_URL` |

`TOUMA_SITE_URL` mérite d'être renseignée explicitement en production : une URL
canonique relative ne veut rien dire pour un moteur de recherche, qui choisit
alors lui-même quelle variante d'adresse indexer.

L'image Docker de production installe les dépendances avec `--workspaces=false` :
elle ne contient que l'API. La vitrine se déploie séparément — c'est une
application Node à part entière, pas un dossier de fichiers statiques.
