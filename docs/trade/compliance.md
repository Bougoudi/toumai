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
