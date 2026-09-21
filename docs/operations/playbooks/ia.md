# L'assistance ne répond plus

## Reconnaître

`/admin/operations` : `Prestataire · Assistance IA` hors `OK`, ou coupe-circuit
ouvert.

## Ce qui se passe tout seul

Le repli déterministe prend le relais. Il **refuse d'inventer** plutôt que de
répondre à côté : sur une question dont il n'a pas la donnée, il répond que
l'information n'est pas disponible.

C'est une dégradation visible et voulue. Une réponse plausible mais fausse sur
un prix ou un délai coûte plus cher qu'une absence de réponse.

## Agir

1. Vérifier le quota et la facturation chez le prestataire : une coupure d'IA
   est le plus souvent un quota épuisé.
2. Si l'indisponibilité dure, éteindre l'assistance (`TOUMA_AI_ENABLED=false`)
   plutôt que de laisser un repli répondre à tout « information non
   disponible » : l'écran donne alors l'impression d'un produit cassé.

## Ne pas faire

Basculer sur un autre modèle sans vérifier le contrat de traitement des
données. Les conversations contiennent des données d'acheteurs.
