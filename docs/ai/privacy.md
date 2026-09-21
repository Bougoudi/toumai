# Données personnelles et IA

## Deux passes distinctes

`lib/redact.ts` traite les **secrets** — carte, jeton, clé, CVV. Il existait
avant V23 et n'est pas dupliqué.

`ai/privacy.ts` traite autre chose : les données personnelles qui ne sont pas
des secrets mais n'ont aucune raison de sortir de Touma. Le numéro de
téléphone d'un acheteur n'est pas un secret : c'est une donnée qui identifie
une personne, et l'envoyer à un tiers pour rédiger une fiche produit n'a
aucune justification.

Les deux passent, sur le chemin obligatoire, avant tout envoi à un
fournisseur et avant toute écriture de trace.

## Ce qui ne part jamais

Par nom de champ : `email`, `phone`, `address`, `recipientName`, `nationalId`,
`passport`, `taxId`, `rccm`, `bankAccount`, `iban`, `kyc`, `documentUrl`,
`birthDate`, et les fragments de secret de `lib/redact.ts`.

Par forme, dans un texte libre : adresses de courriel et numéros de téléphone
(8 à 15 chiffres, formats tchadien et camerounais compris).

Masquer les coordonnées sert deux fins à la fois : la minimisation, et le
refus de la mise en relation hors plateforme, qui est le vecteur de fraude le
plus courant sur une place de marché.

## Les traces

`ToumaAiRequest.input` recopiait l'invite telle quelle en base, y compris ce
qu'un utilisateur y avait collé sans réfléchir. Défaut relevé à l'audit,
corrigé : tout passe par `minimizeForProvider` avant écriture.

Les arguments d'appel d'outil sont minimisés de la même façon. Un identifiant
de commande est utile à l'audit ; une adresse recopiée ne l'est pas.

## Mémoire

Voir `memory.md`. Trois bornes : clés fermées, expiration obligatoire, valeurs
masquées.

## Droit à l'oubli

`DELETE /api/v1/ai/memory` efface tout ou une clé. `DELETE
/api/v1/ai/conversations/:id` supprime une conversation et, par cascade, ses
messages et ses appels d'outils.
