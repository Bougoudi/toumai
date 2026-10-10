# Qualité de l'assistant

Ces mesures existent pour répondre à une question : faut-il laisser
l'assistant ouvert ? Un taux d'échec d'outil qui monte, des signalements
« prix faux » qui s'accumulent, et la réponse devient non.

Rien n'est estimé : tout est compté sur des lignes réellement écrites.

## Ce qui est mesuré

`GET /api/v1/admin/ai/quality?days=30`

- appels d'outils, échecs, taux d'échec ;
- par outil : appels, échecs, latence moyenne ;
- retours utilisateurs par verdict ;
- **signalements factuels** — `INCORRECT`, `WRONG_PRICE`, `WRONG_PRODUCT`,
  `OUTDATED`, `UNSAFE` — et leur taux rapporté au nombre de réponses. Dix
  signalements sur dix mille réponses et dix sur vingt ne disent pas la même
  chose ;
- coût estimé et latence.

## Signalement

Une liste fermée de verdicts, pas un champ libre : « incorrect » et « prix
faux » ne demandent pas la même vérification, et un champ libre unique
produirait un tas de textes que personne ne trierait.

On ne note que ce qu'on a reçu. Sans ce contrôle, n'importe qui pourrait
signaler le message de n'importe qui et fausser la mesure — qui sert ensuite à
décider si l'assistant reste ouvert.

`GET /api/v1/admin/ai/feedback` rend la file des signalements factuels non
traités, la plus ancienne d'abord.

## Ce qui n'est pas mesuré

La justesse des réponses, automatiquement. Il n'existe pas de jeu de
référence, et en inventer un qui note l'assistant sur ses propres sorties
donnerait un chiffre flatteur sans signification. Les signalements humains
sont pour l'instant la seule mesure de justesse, et c'est dit plutôt que
masqué derrière un score.
