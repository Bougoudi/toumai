# Sanctions et recours

## Les états

| État | Retire |
|---|---|
| `ACTIVE` | rien |
| `RESTRICTED` | vendre, publier un produit, répondre à un appel d'offres |
| `SUSPENDED` | ce qui précède, plus acheter et écrire |
| `BANNED` | tout, y compris se connecter |

Ce qu'un état retire est **publié** (`GET /trust/weights`, champ
`standingEffects`) : l'intéressé doit savoir ce qu'il ne peut plus faire.

**Une restriction ne retire pas le droit d'acheter.** Punir l'acheteur pour ce
qu'a fait le vendeur qu'il est par ailleurs n'a pas de sens, et rendrait la
sanction disproportionnée sans la rendre plus efficace.

`User.status` reste l'état **technique** du compte. Le standing est une table à
part parce qu'il lui faut des nuances que l'autre n'a pas.

## Aucune sanction n'est automatique

Le moteur signale ; un administrateur décide. Sa décision porte son nom, son
horodatage, un motif interne, un motif communiqué et ses pièces.

Le motif communiqué est **obligatoire** : sans lui la décision n'est pas
contestable, et une plateforme qui sanctionne sans recours n'a pas une
infrastructure de confiance mais un pouvoir arbitraire.

Un administrateur ne peut pas se sanctionner lui-même. Une restriction
temporaire cesse de restreindre **à la lecture** dès son échéance : un vendeur
dont la sanction expire à minuit n'attend pas le réveil d'un balayage.

## Le recours

`POST /api/v1/trust/appeals` — sujets : `VERIFICATION`, `STANDING`, `REVIEW`,
`TRUST_SCORE`.

- **Un seul recours en cours par sujet**, pour éviter le harcèlement de file.
- **Une décision motivée**, toujours : un rejet sans un mot vaut moins qu'un
  recours impossible, parce qu'il fait croire à un examen qui n'a pas eu lieu.
- **Un recours tranché ne se rejuge pas** en silence : la seconde décision est
  refusée.
- Tout est audité et notifié.

## Ce qui n'existe pas encore

Un recours approuvé ne lève pas automatiquement la sanction : l'administrateur
doit remettre le compte en `ACTIVE`. C'est deux actions au lieu d'une, et c'est
assumé — un automatisme qui rétablit un compte sur la seule approbation d'un
recours enlèverait à l'administrateur la décision de ce qu'il rétablit
exactement.
