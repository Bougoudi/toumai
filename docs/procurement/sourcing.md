# Trouver un fournisseur : pourquoi celui-là

> V28 §3, §4. État au 22 septembre 2026.

## Ce que l'audit a trouvé

La recherche fournisseurs existait déjà, et elle était bien conçue : **tout y
est observé, rien n'y est déclaré**.

| Donnée | D'où elle vient |
|---|---|
| Capacité | le stock réellement saisi |
| Pays desservis | les expéditions réellement effectuées |
| Délais | les offres et livraisons passées |
| Réputation | le module dédié, avec sa règle de volume minimal |

Un fournisseur ne peut pas se prétendre capable de dix tonnes sans les avoir en
stock. §3 était donc largement fait.

**Ce qui manquait : l'explication.** La recherche filtrait et classait sans
jamais dire pourquoi. Les poids du tri vivaient dans une fonction que personne
ne voit, et l'acheteur recevait une liste ordonnée sans savoir ce qui avait
décidé de l'ordre.

C'est exactement ce contre quoi §4 met en garde — « ne pas présenter une
correspondance comme garantie ». Une liste ordonnée sans justification *est*
une garantie implicite : elle dit « le premier est le meilleur » sans jamais
l'écrire, donc sans jamais pouvoir être contredite.

## Les raisons, et leur poids

Chaque résultat porte maintenant ses `matchReasons` :

```
? [4] Livre vers CM        — n’a encore expédié nulle part : rien ne dit qu’il
                             ne peut pas livrer là-bas, seulement qu’il ne l’a
                             jamais fait
✓ [3] Peut servir 5 unités — au moins une référence a 5 unités ou plus en stock
✓ [2] Vendeur vérifié      — ses pièces ont été contrôlées ; cette vérification
                             ne garantit pas la transaction
```

Le nombre entre crochets est le **poids réel** du critère dans le classement
par pertinence. Il est publié pour que l'ordre soit contestable : un acheteur
qui voit un fournisseur desservant sa destination passer devant un fournisseur
mieux noté peut comprendre pourquoi, et changer de tri s'il n'est pas d'accord.

## Une seule table de poids

`POIDS` est lue par le tri **et** par l'affichage. Les séparer les aurait
laissés diverger, et les raisons affichées auraient fini par expliquer un
classement qu'on n'applique plus.

Un test reconstitue le score depuis les poids publiés. Désynchroniser les deux
le fait échouer.

| Critère | Poids |
|---|---|
| Livre vers la destination demandée | 4 |
| Peut servir le volume demandé | 3 |
| Vendeur vérifié | 2 |
| Réputation mesurée | 1 au plus |
| Indice de confiance | 1 au plus |

Desservir réellement la destination pèse plus qu'une réputation parfaite. Ce
n'est pas arbitraire : un fournisseur qui livre là où l'acheteur veut être
livré lui est plus utile qu'un fournisseur mieux noté qui ne dessert pas sa
province.

**Rien ne peut acheter ce classement.** Aucun terme ne regarde une promotion,
une mise en avant ni un paiement. Le jour où une mise en avant payante
existera, elle devra être une liste séparée et étiquetée comme telle.

## Deux règles d'énonciation

**On n'énonce que ce que l'acheteur a demandé.** Afficher « ✓ pays desservi »
quand aucun pays n'a été précisé est un faux signal : un critère satisfait là
où il n'y a pas de critère.

**« Non mesuré » n'est pas « non satisfait ».** Un fournisseur qui n'a jamais
expédié n'a pas échoué à desservir une destination — personne ne lui a encore
rien demandé. De même, une réputation absente n'est pas une mauvaise
réputation : elle n'est simplement pas signalée, plutôt que rendue comme une
ligne qui ferait passer un fournisseur nouveau pour un mauvais choix.

### Un défaut trouvé en regardant la réponse réelle

La première version marquait `✗` un fournisseur sans historique d'expédition,
tout en affichant sur la même ligne « n'a encore expédié nulle part ». La
pastille et le texte se contredisaient — et c'est la pastille qu'un acheteur
lit en premier.

La cause : `servesDestination` vaut `false` quand la liste des pays desservis
est vide, ce qui est mécaniquement juste et trompeur. Sans historique, l'état
est désormais « non mesuré ». Un test l'épingle.

Ce défaut ne se voyait pas en relisant le code. Il s'est vu en affichant la
réponse du serveur.

## Ce qui n'est pas fait

`SupplierType` (§1 : fabricant, grossiste, distributeur…) n'existe pas : TOUMA
ne sait pas si une boutique fabrique ou revend, et l'inventer serait une
donnée fausse sur une fiche publique. Il faudra le demander au fournisseur.

Les conditions commerciales, les certifications et les documents (§2) ne sont
pas modélisés côté fournisseur. Une certification inventée est explicitement
interdite par §58 ; en l'absence de dépôt de pièces, rien n'est affiché.
