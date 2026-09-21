# Corridors

## Un corridor n'est pas actif parce qu'il est déclaré actif

C'est la règle centrale de V24, et elle a une conséquence visible : l'API rend
**deux champs**, jamais fondus.

- `declaredStatus` — ce que l'exploitant a enregistré.
- `operational` — ce que la configuration permet réellement, recalculé à
  chaque lecture.

Quand ils divergent, `missing` dit pourquoi. Fondre les deux en un seul voyant
vert reviendrait à promettre une livraison que personne ne peut faire.

## Ce qui est vérifié

`capability()` croise trois sources : le corridor, la configuration
commerciale des **deux** pays, et les transporteurs enregistrés.

**Un moyen de paiement doit exister des deux côtés.** L'intersection, jamais
l'union : un moyen disponible au Tchad et pas au Cameroun ne permet pas de
payer un vendeur camerounais.

**Un transporteur doit couvrir les deux pays.** « Dessert TD » ne dit pas
« achemine de TD vers CM ». C'est le minimum vérifiable sans interroger le
prestataire.

**Un adaptateur de simulation ne compte pas.** `mock`, `test`, `sandbox`,
`fake`, `dummy` sont exclus. Ils répondent à tout, y compris à des corridors
que personne ne dessert.

Ce dernier point a été trouvé par un essai en navigateur, pas par une
relecture du code : le corridor TD → CM s'affichait « opérationnel » grâce au
transporteur `mock` du référentiel de développement. Une simulation
n'achemine aucun colis, et le laisser compter aurait promis une livraison sur
la foi d'un prestataire fictif — ce que V20 §52 et V24 §72 interdisent l'un
comme l'autre.

## Corridors orientés

TD → CM et CM → TD sont **deux lignes distinctes**. Ce n'est pas une
redondance : les moyens de paiement, les transporteurs et les documents exigés
diffèrent selon le sens, et un corridor symétrique obligerait à mentir dans
un des deux sens.

## Cycle de vie

| Statut | Ce qu'il veut dire |
|---|---|
| `COMING_SOON` | saisi, pas ouvert — **état à la création** |
| `LIMITED` | ouvert avec des restrictions |
| `ACTIVE` | ouvert |
| `SUSPENDED` | fermé par décision de l'exploitant |

Un corridor est **toujours créé en `COMING_SOON`**. Il s'ouvre après
vérification des prestataires, pas au moment où on le saisit.

Le passage à `ACTIVE` est **refusé** tant que la capacité réelle n'est pas
réunie, avec la liste de ce qui manque. Ce n'est pas une politesse : un
corridor annoncé actif sans transporteur promet une livraison que personne ne
peut faire.

## Configurer Tchad ↔ Cameroun

```
TOUMA_TRADE_ENABLED=true
```

Puis, par l'API d'administration :

1. `PUT /admin/trade/countries/TD` et `/CM` — `tradeEnabled`, devises, moyens
   de paiement réellement disponibles dans **chaque** pays.
2. `POST /admin/trade/corridors` pour TD → CM, puis pour CM → TD.
3. Enregistrer un transporteur **réel** couvrant les deux pays.
4. `PATCH /admin/trade/corridors/:id` avec `status: ACTIVE`. Le refus, s'il
   vient, nomme ce qui manque.

Aucune de ces étapes n'est faite au déploiement. Un corridor livré ouvert
serait un corridor ouvert sans que personne ne l'ait décidé.
