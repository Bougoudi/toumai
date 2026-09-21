# Conformité et règles

## Ce que Touma n'est pas

Touma n'est ni une banque, ni une société de douane, ni un transporteur
propriétaire. Elle fournit une infrastructure logicielle et s'intègre avec des
partenaires.

Conséquence directe et non négociable : **aucune réglementation n'est
inventée**. Il n'existe dans ce dépôt aucune liste de produits interdits,
aucun barème douanier, aucun tarif, aucun certificat généré.

## Règles versionnées et sourcées

Chaque règle est une `ToumaTradeRuleVersion` :

- `sourceName` est **obligatoire**. Une règle sans source est une
  réglementation inventée, et elle n'est opposable à personne.
- `sourceUrl` et `reviewedAt` permettent de retrouver et de dater la relecture.
  Une règle jamais relue vieillit en silence.
- Une version n'est **jamais modifiée**. Elle est remplacée, et l'ancienne
  passe à `SUPERSEDED`. Une commande passée sous une règle garde la règle de ce
  jour-là (§19).
- Une règle est créée en `DRAFT`. Elle ne s'applique qu'après activation
  explicite : une règle applicable dès la saisie changerait le comportement
  avant toute relecture.

## Restrictions produit

`ToumaCrossBorderProductRule` s'applique à un produit ou à une catégorie :
pays autorisés, pays bloqués, corridors autorisés, examen requis, documents
exigés.

Aucune n'est livrée avec Touma. Chacune est saisie par l'exploitant, et fondée
sur une version de règle sourcée. Une restriction sans fondement est un refus
arbitraire — et pour un vendeur, c'est sa marchandise qui est bloquée au nom
d'une règle qui n'existe pas.

## Éligibilité

Quatre verdicts, du plus sévère au plus favorable : `NOT_ELIGIBLE`,
`REQUIRES_DOCUMENT`, `REQUIRES_REVIEW`, `ELIGIBLE`. **Le plus sévère
l'emporte** : un produit qui exige un document et dont le corridor est suspendu
n'est pas « en attente de document », il est refusé.

Chaque critère est nommé, réussi ou non. Un refus dont on ne peut pas dire
pourquoi est un refus qu'on ne peut pas corriger.

Un vendeur non vérifié n'est **pas refusé** : il passe en revue. Le refuser
d'office fermerait le transfrontalier à tout nouveau vendeur — ce n'est pas
une règle, c'est un blocage.

## Risque

Chaque signal porte son poids et **le fait qui l'a produit**. Les poids et les
seuils sont publiés par `explainModel()` : un score opaque n'est pas
contestable, et un vendeur à qui l'on demande un document doit pouvoir savoir
pourquoi.

`HOLD` est **proposé**, jamais appliqué par le moteur. Bloquer une marchandise
sur une addition de pondérations arrêterait le commerce de quelqu'un.

Un signal non mesurable — un vendeur sans historique de confiance — est rendu
comme non mesuré. Il ne vaut pas « risque nul ».

## Origine de la marchandise

Trois pays étaient confondus derrière un seul champ, et ce sont trois faits
distincts :

| Champ | Ce qu'il dit |
|---|---|
| `ToumaProduct.countryCode` | d'où **part le colis** |
| `ToumaStore.countryCode` | où le **vendeur** est établi |
| `ToumaProduct.countryOfOrigin` | d'où vient la **marchandise** |

Un colis parti de N'Djamena, vendu par une boutique camerounaise, peut contenir
un article fabriqué ailleurs. C'est le troisième champ — et lui seul — qui
fonde un certificat d'origine : établir le document sur le pays d'expédition
produirait une pièce douanière fausse.

Le vendeur déclare l'origine depuis sa fiche produit. Le statut enregistré est
**toujours** `DECLARED`, jamais `VERIFIED` : Touma ne vérifie l'origine
d'aucune marchandise, et §11 est explicite — si l'information n'est pas
vérifiée, le statut est `DECLARED`. Un champ que le vendeur remplit lui-même ne
peut pas valoir vérification.

`originStatus` accompagne toujours `countryOfOrigin` dans les réponses de
l'API, et les interfaces l'affichent : « Déclarée par le vendeur. Touma ne l'a
pas vérifiée. » Un pays d'origine rendu seul se lirait comme un fait établi.

Effacer la déclaration ramène le statut à `UNKNOWN` et supprime la
justification : une preuve qui survivrait à l'affirmation qu'elle appuyait
serait orpheline.

### Ce que cela débloquait

Ces champs existaient depuis V24 et **aucun chemin d'écriture ne les
remplissait**. `eligibility.check` les lisait déjà : tout contrôle
transfrontalier signalait donc « pays d'origine non déclaré » pour chaque
produit, sans qu'aucun vendeur puisse y remédier. Le lecteur avait été écrit
sans l'écrivain.

## Recherche transfrontalière (§60)

`GET /api/v1/products` accepte quatre axes en plus des filtres existants :

| Paramètre | Effet |
|---|---|
| `country` | pays d'expédition (inchangé) |
| `sellerCountry` | pays où la boutique est établie |
| `originCountry` | origine **déclarée** ; les produits sans déclaration sont exclus |
| `deliverTo` | ne garde que ce qui peut **réellement** atteindre ce pays |
| `corridor` | code (`TD_CM`) ou adresse lisible (`tchad-cameroun`) |

`deliverTo` est le seul qui engage quelque chose vis-à-vis d'un acheteur, et
il est donc le plus contraint. Il retient le pays lui-même — le commerce
national ne dépend d'aucun corridor, et §73 exige qu'il continue de
fonctionner — puis les origines des corridors **opérationnels** vers ce pays.
Pas ceux déclarés actifs : ceux qui le sont. Retirer le dernier transporteur
réel d'un corridor fait disparaître ses produits de `deliverTo` à la lecture
suivante, sans qu'aucune donnée produit soit touchée.

Une adresse de corridor inconnue **vide** la recherche au lieu de l'élargir.
Ignorer un filtre incompris rendrait des résultats que personne n'a demandés.

Les compteurs de facettes portent les mêmes restrictions que la liste : des
facettes calculées sans elles annonceraient « Tchad (42) » au-dessus d'une
liste vide.
