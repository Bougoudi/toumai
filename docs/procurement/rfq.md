# Appels d'offres : cloisonnement et comparaison

> V28 §6, §7, §47. État au 22 septembre 2026.

## Ce que l'audit a trouvé

Le cloisonnement du réseau d'approvisionnement **était déjà correct dans le
code**. `b2b.service.ts` restreint la lecture des offres à `sellerId: user.id`
pour qui n'est pas l'acheteur ; `loadNegotiation` rend « introuvable » la
négociation d'autrui, jamais « interdite ».

Ce qui manquait : **rien ne le testait**.

Une propriété de sécurité que personne ne vérifie est à une réécriture de se
perdre. Et celle-ci n'est pas une fuite de données parmi d'autres — c'est ce
qui fait tenir le mécanisme. Un fournisseur qui verrait le prix de son
concurrent n'aurait plus aucune raison de faire une offre honnête, et
l'acheteur n'obtiendrait plus jamais le meilleur prix.

Sept tests adversariaux l'épinglent désormais, écrits du point de vue d'un
fournisseur légitime de l'appel d'offres qui essaie de voir ce que ses
concurrents ont proposé :

| Tentative | Réponse |
|---|---|
| Lire la fiche de l'appel d'offres | seulement sa propre offre |
| Lire la négociation d'un concurrent | **404**, jamais 403 |
| Écrire dans la négociation d'un concurrent | 404, aucun message écrit |
| Contre-proposer sur l'offre d'un concurrent | 404, offre intacte |
| Lire « mes offres » | seulement les siennes |
| Lire la comparaison | 404 |
| Lire sans compte | aucune offre |

Mis à l'épreuve en retirant le filtre `sellerId` : les tests échouent.

### Un faux positif corrigé en cours de route

La première version cherchait le prix du concurrent comme suite de chiffres
dans la réponse JSON. Elle échouait — mais pas pour la bonne raison : `790`
apparaissait dans un horodatage (`1790087791845`) et dans un identifiant. Les
assertions portent maintenant sur la **valeur JSON entière**, guillemets
compris, et sur l'identifiant du fournisseur concurrent.

## La comparaison ne désigne pas de gagnant

`GET /api/v1/rfqs/:id/comparison` pose les offres côte à côte. Elle ne produit
ni score, ni classement, ni « meilleur fournisseur ». Un test vérifie
qu'aucun champ nommé `rank`, `winner`, `best` ou `recommended` n'apparaît.

Trois raisons, toutes concrètes :

1. **Les devises ne s'additionnent pas.** Une offre en XAF et une en NGN ne se
   comparent qu'avec un taux officiel. Sans source de change configurée, tout
   classement reposerait sur un taux inventé — interdit depuis V20 §49.
2. **Le coût rendu est souvent incomplet.** Les droits de douane sont
   `UNKNOWN` tant qu'aucune source ne les donne. Classer sur un total dont une
   composante manque, c'est classer sur autre chose que le coût.
3. **L'arbitrage n'est pas technique.** Un acheteur peut préférer payer 8 % de
   plus pour un fournisseur vérifié, ou pour dix jours de moins. Ce compromis
   lui appartient ; un score le lui retirerait en le cachant derrière un
   chiffre.

### Ce qu'elle dit quand même

Dimension par dimension, **laquelle est la plus basse ou la plus rapide**. Ce
sont des faits, pas des recommandations — et ils ne sont énoncés que
lorsqu'ils ont un sens :

- les montants, **uniquement** si toutes les offres sont dans la même devise ;
- le délai, toujours — un jour est un jour partout ;
- les offres expirées sont exclues : signaler comme « la moins chère » une
  offre qu'on ne peut plus accepter est une information qui trompe.

`noRankingBecause` dit pourquoi aucun classement global ne sort :
`DEVISES_DIFFERENTES`, `COUT_INCOMPLET`, `UNE_SEULE_OFFRE`.

### Le prix unitaire est calculé

Jamais recopié du fournisseur. Un fournisseur qui annoncerait son propre prix
unitaire pourrait le dissocier de son total, et la comparaison porterait alors
sur un chiffre que personne ne s'est engagé à tenir.

### La confiance : trois états, pas deux

`trust: null` — aucun score n'existe. `trust.score: null` — un score existe
sans valeur mesurable. Les deux veulent dire « on ne sait pas », jamais
« c'est mauvais ». Un fournisseur nouveau n'est pas un mauvais fournisseur.

## Le coût rendu vient de V24

`costService.estimate()` était déjà écrit, avec exactement le contrat que §8
demande : `CONFIRMED` / `ESTIMATED` / `UNKNOWN` par ligne, et aucun droit de
douane inventé. Il est **réutilisé**, pas redéveloppé.

Une ligne `UNKNOWN` ne vaut pas zéro : elle rend le total incomplet, et
`total` reste `null` tant que quelque chose manque. Un test le vérifie.

## Ce qui n'est pas fait

V28 demande 61 parties. Cette livraison en couvre deux — §6/§47 (cloisonnement,
épinglé) et §7 (comparaison) — et constate que §8 existait déjà.

Restent entières : le réseau de fournisseurs (§1 à §5), les accords (§10), le
catalogue fournisseur (§12 à §15), l'onboarding (§16), les performances (§19 à
§21), l'automatisation (§22 à §25), l'assistant IA (§26, §27, §54), et les
interfaces (§35 à §39, §53).
