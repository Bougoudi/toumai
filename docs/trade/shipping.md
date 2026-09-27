# Transport transfrontalier

## Ce que V24 ajoute à V18

V18 orchestre déjà les transporteurs : devis, expédition, suivi. V24 n'en
refait rien. Il ajoute deux choses que V18 ne sait pas : **le corridor est-il
couvert**, et que faire quand un colis s'arrête.

## Aucun tarif inventé

Trois états, et leur distinction compte :

| État | Ce qu'il veut dire |
|---|---|
| `available` | un transporteur a chiffré l'expédition |
| `unavailable` | le corridor n'est pas opérationnel — le motif l'accompagne |
| `requires_review` | le corridor est ouvert, **aucun transporteur n'a répondu** |

Le troisième n'est pas le second. Un corridor fermé est une décision ; un
corridor ouvert sans réponse de transporteur est un incident que l'exploitant
doit voir. Dans les deux cas, aucun tarif n'est proposé — il serait inventé.

Un transporteur qui « dessert TD » ne dit pas qu'il « achemine de TD vers
CM ». La liste `countries` de V18 répond à la première question ; la capacité
de corridor exige les deux pays chez le même transporteur.

## Aucune cause attribuée sans source

C'est la règle qui coûte cher quand on l'oublie. Annoncer « retenu en douane »
sans que le transporteur l'ait dit envoie l'acheteur réclamer auprès d'une
administration qui n'a jamais vu son colis.

Donc : `raiseException` retombe sur `UNKNOWN` dès que `sourceName` est absent,
**même si un appelant propose une cause précise**. Le détail observé est
conservé — il dit ce qu'on a vu — mais la cause n'est pas affirmée.

Les incidents rendus portent `causeAttributed`, pour que l'interface écrive
« cause non établie » plutôt que d'afficher `UNKNOWN` comme un diagnostic.

## Livraison unique : jamais promise à tort

Le checkout crée déjà une commande par boutique (V17). `groupability()` le
rend explicite : deux vendeurs distincts remettent leurs colis à deux
endroits, donc deux expéditions. Promettre une livraison unique alors que les
transporteurs ne la font pas serait une promesse impossible à tenir.

## Délais

`etaMinDays` / `etaMaxDays` viennent du transporteur et sont rendus avec sa
source. Ce sont des **estimations**, jamais des garanties — et la chronologie
n'annonce jamais l'étape suivante comme certaine, seulement comme possible.
