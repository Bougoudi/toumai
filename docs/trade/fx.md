# Taux de change

## L'état réel

**Aucune source de taux n'est branchée.** `fxService.status()` rend
`configured: false`, et `convert()` rend `available: false` avec le motif.
L'interface affiche « Conversion indisponible » plutôt qu'un montant.

Ce n'est pas un manque : c'est la seule position tenable. Il n'existait aucune
notion de taux de change dans tout le dépôt avant V24, parce que V20 interdit
les taux fictifs et n'additionne jamais deux devises. V24 crée l'abstraction
sans changer cette règle.

Un taux inventé au milieu d'une commande transfrontalière se transforme en
écart de caisse chez le vendeur.

## Ce qu'un taux doit porter pour être un taux

Trois choses, toutes obligatoires : **une source, un horodatage, une
validité**.

- `sourceName` est exigé à l'enregistrement. Un taux sans source est un chiffre
  que personne ne peut contester.
- `rateAt` est l'horodatage **du taux**, pas de son enregistrement.
- `expiresAt` est posé automatiquement. Sans expiration, le taux de l'an
  dernier servirait encore aujourd'hui sans que personne s'en aperçoive.

`source: NONE` est refusé à l'enregistrement : cela signifie « pas de source »,
ce qui ne s'enregistre pas.

## Une conversion ne se sépare jamais de son taux

`convert()` rend le montant **et** le taux employé. Les afficher séparément
permettrait de montrer une conversion dont on ne peut plus dire d'où elle
vient (§25).

Une devise vers elle-même vaut 1 — par définition, pas par convention : aucune
source n'est requise.

## Pour brancher une source

```
TOUMA_TRADE_FX_ENABLED=true
TOUMA_TRADE_FX_PROVIDER=manual   # taux saisis par un administrateur
TOUMA_TRADE_FX_TTL_MINUTES=60
```

`manual` est légitime : une banque centrale publie un taux qu'un exploitant
recopie, avec son nom de source et sa date. `EXTERNAL_PROVIDER` et
`CENTRAL_BANK` sont nommés au cahier des charges et **non écrits** : brancher
une API de change demande un contrat, pas du code, et les enregistrer vides
ferait croire qu'il suffit d'une clé.
