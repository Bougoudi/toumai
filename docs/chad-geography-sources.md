# Géographie du Tchad — source, structure et limites

Ce document répond à une question simple : **d'où viennent les 23 provinces,
133 départements et 12 268 localités qui sont en base**, et jusqu'où peut-on
leur faire confiance.

Il existe parce que le §58 du cahier des charges l'exige, et parce qu'une donnée
géographique sans provenance est une donnée qu'on ne peut ni vérifier, ni mettre
à jour, ni corriger.

---

## La source

**GeoNames** — <https://www.geonames.org>

| | |
|---|---|
| Licence | Creative Commons Attribution 4.0 (CC BY 4.0) |
| Fichiers utilisés | `TD.zip`, `alternatenames/TD.zip`, `admin1CodesASCII.txt`, `admin2Codes.txt` |
| Date de récupération | 14 septembre 2026 |
| Attribution requise | oui — mentionnée ici et dans l'en-tête du jeu de données |

GeoNames agrège des sources nationales et internationales, dont les fichiers
du *National Geospatial-Intelligence Agency* et les contributions vérifiées de
sa communauté. Ce n'est pas une source officielle de l'État tchadien, et **c'est
la limite principale de tout ce qui suit**.

### Pourquoi celle-ci

Trois critères, dans cet ordre :

1. **Elle couvre les quatre niveaux d'un coup** — pays, province, département,
   lieu habité — avec des identifiants stables qui permettent de rejouer une
   mise à jour sans deviner les correspondances.
2. **Elle est redistribuable.** CC BY 4.0 autorise l'inclusion du jeu de données
   dans le dépôt, condition pour que `prisma db seed` fonctionne sans réseau.
3. **Elle est vérifiable ligne à ligne.** Chaque province, département et
   localité conserve son `sourceId` GeoNames en base : n'importe qui peut
   remonter à l'enregistrement d'origine.

### Ce qui serait mieux

La référence à viser est le **COD-AB** (*Common Operational Datasets —
Administrative Boundaries*) du Tchad, publié sur HDX et dérivé des données de
l'INSEED. Elle est plus proche de l'autorité nationale et descend plus bas dans
la hiérarchie. Elle n'a pas été retenue ici pour une raison pratique : elle est
distribuée en fichiers géospatiaux (shapefile, GeoPackage) dont l'exploitation
demande une chaîne d'outils que ce dépôt n'a pas, et dont l'intégration mérite
d'être faite une fois, correctement, plutôt qu'à moitié.

**Le remplacement est prévu par la structure** : les tables portent toutes un
`sourceId`, et le script de construction est isolé. Changer de source, c'est
réécrire `scripts/build-chad-geography.mjs`, pas le modèle de données.

---

## Structure du jeu de données

Fichier : `prisma/seed-data/chad-geography.tsv` — TSV, trié, lisible en diff.

| Préfixe | Niveau | Colonnes |
|---|---|---|
| `P` | Province | code, nom, nom arabe, identifiant source |
| `D` | Département | code, code province, nom, nom arabe, identifiant source |
| `L` | Localité | identifiant source, code province, code département, nom, nom arabe, type, latitude, longitude, population |

Régénération :

```bash
mkdir -p /tmp/geonames/geo /tmp/geonames/alt && cd /tmp/geonames
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
curl -O https://download.geonames.org/export/dump/admin2Codes.txt
(cd geo && curl -sO https://download.geonames.org/export/dump/TD.zip && unzip -o TD.zip)
(cd alt && curl -sO https://download.geonames.org/export/dump/alternatenames/TD.zip && unzip -o TD.zip)
cd /chemin/vers/toumai && node scripts/build-chad-geography.mjs --geonames /tmp/geonames
```

Le chargement en base est fait par `src/touma/geo/geography.loader.ts`, appelé
par le seed. Il est **idempotent** : rejouer `npm run seed` ne duplique rien.

---

## Ce que contient la base

| Niveau | Nombre | Rattachement |
|---|---|---|
| Provinces | **23** | toutes au Tchad |
| Départements | **133** | tous à leur province |
| Sous-préfectures | **0** | — |
| Localités | **12 268** | toutes à leur province ; **1** seule à un département |

Les 23 provinces correspondent exactement à la liste officielle. **23 sur 23
portent leur nom arabe**, seconde langue officielle du Tchad.

---

## Les trois limites, écrites plutôt que masquées

### 1. Aucune sous-préfecture

GeoNames ne descend pas au troisième niveau administratif pour le Tchad : le
fichier ne contient **aucun** enregistrement `ADM3`.

La table `ToumaSubPrefecture` existe — le modèle la prévoit, et le jour où une
source paraît rien n'aura à être remanié — mais elle est **vide, et le restera**
tant qu'une source fiable n'aura pas été raccordée.

Remplir de mémoire les sous-préfectures d'un État reviendrait à inscrire en base
une organisation administrative inventée, que des acheteurs, des vendeurs et un
jour une administration prendraient pour argent comptant.

### 2. Les localités ne connaissent pas leur département

Sur 12 268 localités, **une seule** porte un code de département dans la source.
Toutes portent en revanche leur province.

`ToumaLocality.departmentId` est donc **nullable**, ce qui dévie du modèle décrit
au §4 du cahier des charges. La déviation est assumée : l'alternative aurait été
d'attribuer un département « au plus proche » à 12 267 localités, c'est-à-dire
de fabriquer une donnée administrative massive et de la présenter comme
officielle.

Conséquence concrète : **le filtrage par département ne donnera presque rien**
tant que cette limite n'est pas levée. Le filtrage par province, lui, fonctionne
sur la totalité du territoire.

### 3. Neuf localités sans province

Neuf lieux habités portent le code province `00` — « non assignée » chez
GeoNames. Ils sont **écartés du chargement**, et le seed le dit à voix haute
plutôt que de les rattacher à une province voisine.

---

## Autres réserves à connaître

- **La population est presque toujours inconnue.** 75 localités sur 12 268 sont
  chiffrées. Dans la base, `population` nul veut dire *inconnue*, jamais *zéro* —
  ne jamais s'en servir pour classer ou filtrer.
- **Le type d'une localité est prudent.** GeoNames distingue la capitale
  (`PPLC`), les chefs-lieux (`PPLA`) et les sections urbaines (`PPLX`), mais ne
  dit pas si un lieu habité ordinaire est une ville ou un village. Tout le reste
  est donc rendu `LOCALITY`, et non affirmé `VILLAGE` ou `TOWN`.
- **Les graphies diffèrent parfois de l'usage officiel** : la source écrit
  « Ouadaï », « N’Djaména », « Barh el Gazel ». Les codes officiels, eux, sont
  conservés tels quels : ce sont eux qui font la jointure, pas l'orthographe.
- **Les noms arabes ne sont retenus que lorsque la source les étiquette comme
  tels.** Le fichier principal mêle toutes les variantes sans langue ; y choisir
  « le premier mot en écriture arabe » aurait promu une translittération au
  hasard au rang de nom officiel. Seul le fichier des noms alternatifs, qui
  porte le code de langue, est utilisé.

---

## Mise à jour

Les découpages administratifs changent — le Tchad est passé de 22 à 23 provinces
en 2012, puis a redécoupé l'Ennedi en 2018.

Marche à suivre :

1. retélécharger les fichiers GeoNames ;
2. régénérer le TSV avec le script ;
3. **lire le diff** — c'est là que se voient les créations, fusions et
   renommages ;
4. rejouer le seed, qui met à jour sans dupliquer.

Une province retirée d'une source ne doit **jamais** être supprimée en base :
des commandes, des adresses et des boutiques la référencent. Elle se désactive
(`active = false`), ce qui la retire de la saisie sans rendre l'histoire
illisible.
