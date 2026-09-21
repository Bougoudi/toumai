# Les agents

## L'enchaînement d'un tour

```
message → analyse d'injection → plan → outils réels → rédaction → trace
```

## Le planificateur (`agents/intent.ts`)

Sans modèle de langage configuré, c'est lui qui fait fonctionner l'assistant —
pas une maquette qui attendrait une clé. Il lit une phrase en français, en
déduit une intention parmi vingt-trois, et choisit les outils à appeler.

Avec un modèle branché il reste utile : il sert de repli et de garde-fou, et
une intention lue deux fois de la même manière vaut mieux qu'une intention
devinée différemment selon le jour.

L'ordre des tests n'est pas arbitraire : les intentions les plus spécifiques
passent avant les plus générales. « Compare ces deux produits » contient le
mot « produits » et déclencherait une recherche si la comparaison n'était pas
testée d'abord.

Il ne répond jamais lui-même. Il dit **quoi aller chercher**.

## Le rédacteur (`agents/composer.ts`)

Sa règle tient en une ligne : toute valeur affichée doit provenir d'un
résultat d'outil. Pas de chiffre calculé de tête, pas de délai estimé, pas de
qualificatif — « bonne affaire », « vendeur sérieux », « livraison rapide »
sont des jugements que rien ne fonde.

Les seuls calculs sont des sommes de valeurs rapportées, **par devise**,
jamais entre devises.

Quand les outils n'ont rien rapporté : « Information non disponible », suivi
de ce qui manque. Une réponse vide est un résultat correct ; une réponse
comblée ne l'est jamais.

## Les quatre espaces

| Espace | Route | Qui |
|---|---|---|
| Acheteur | `POST /api/v1/ai/chat` | tout le monde, visiteurs compris |
| Vendeur | `POST /api/v1/seller/ai` | rôle SELLER |
| Professionnel | `POST /api/v1/business/ai` | compte connecté |
| Administration | `POST /api/v1/admin/ai/query` | rôle ADMIN |

C'est l'espace qui décide des outils. Laisser la surface au choix de
l'appelant reviendrait à laisser un acheteur demander la surface vendeur.

## Copilote vendeur : trois blocs séparés

**DONNÉES** — ce qui est mesuré.
**INTERPRÉTATION** — une variation constatée, sans cause avancée.
**RECOMMANDATION** — vide, et c'est dit.

La cause d'une baisse de ventes est presque toujours hors de la base : une
rupture d'approvisionnement, un concurrent, une saison, un incident de
transport. Fondre les trois dans une phrase ferait passer une hypothèse pour
un constat.

## Escalade

`escalateToHuman` ouvre un ticket de support quand l'assistant ne peut pas
répondre. Classé `LOW_RISK` : ouvrir un ticket n'engage rien, et son absence
engage beaucoup — un acheteur laissé sans réponse. Exiger une confirmation
pour demander de l'aide serait une porte fermée au moment où elle doit
s'ouvrir.

## Prix, demande, bilans

Trois lectures calculées en base, sans modèle, et trois refus qui les
définissent.

**Le prix** est situé, jamais jugé. « Ce prix se situe 18 % au-dessus de la
médiane des 23 produits comparables » est un fait. « C'est trop cher » suppose
un budget qu'on ne connaît pas ; « c'est une bonne affaire » suppose une
qualité qu'on ne mesure pas. Et la fourchette rassemble des prix **affichés**,
pas des prix payés — la réponse le rappelle à chaque fois, parce qu'un vendeur
qui s'y positionne s'appuierait sinon sur un chiffre qu'il croit être une
valeur de marché.

Aucun outil ne recommande de changer un prix. Une machine qui conseille à
chacun de s'aligner sur la médiane pousse tout un marché vers le même chiffre
sans avoir vu un seul produit.

**La demande** n'annonce une hausse que si le volume la rend lisible. En
dessous du plancher, la réponse est « information non disponible », et non une
hausse de 200 % entre une et trois recherches. Les vues produit et les ajouts
au panier ne sont pas journalisés dans Touma : ils sont **nommés comme
absents** plutôt que remplacés par un signal approchant.

**Le bilan** a quatre rubriques : observé, variations, anomalies, et *à
vérifier*. Le cahier des charges demandait « explications possibles » ; c'est
devenu des questions, délibérément. « Les ventes ont baissé de 30 % — vérifier
s'il y a eu une rupture » est utile. « Les ventes ont baissé parce qu'il y a eu
une rupture » serait faux une fois sur deux, et se lirait comme un constat.
