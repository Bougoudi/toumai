# Vérification

## Les niveaux

| Niveau | Exige en plus | Antériorité |
|---|---|---|
| `BASIC` | adresse électronique, pièce d'identité relue | — |
| `BUSINESS` | adresse déclarée, registre du commerce et identifiant fiscal | — |
| `PRO` | historique de transactions | 25 livraisons |
| `ENTERPRISE` | existence légale confirmée par un registre, compte de règlement confirmé | 100 livraisons |

Chaque niveau exige **les signaux du précédent plus les siens**. Aucun ne
s'achète, aucun ne s'obtient par ancienneté seule.

## Trois signaux hors d'atteinte, et pourquoi on le dit

| Signal | Ce qu'il atteste | Ce qu'il faut |
|---|---|---|
| `PHONE_CONFIRMED` | le porteur a saisi un code reçu par SMS | un fournisseur SMS |
| `COMPANY_REGISTRY` | l'entreprise existe légalement | un accès registre ou un prestataire KYB |
| `PAYOUT_ACCOUNT` | le compte de règlement appartient au vendeur | un PSP |

Aucun n'est engagé. `ENTERPRISE` est donc **inatteignable**, et l'API le dit :
`GET /trust/weights` rend `verification.unavailableSignals`.

C'est un choix, pas un oubli. Il aurait été facile de considérer qu'un numéro
saisi est un numéro vérifié. Personne ne l'aurait remarqué — jusqu'au jour où un
acheteur aurait appelé un vendeur « au téléphone vérifié » sur un numéro que
personne n'a jamais confirmé.

Même raison pour le score acheteur : la composante s'appelle `VERIFIED_CONTACT`
mais son détail porte `phoneConfirmedBySms: false`, parce que c'est la vérité.
Elle mesure qu'un numéro normalisé figure au dossier. Rien de plus.

## La frontière KYC/KYB

`verification-provider.ts` **ne vérifie rien**. C'est une interface —
`submitVerification`, `getVerificationStatus`, `handleWebhook` — et deux
implémentations :

- `LOCAL` : ce que TOUMA fait réellement aujourd'hui, un administrateur ouvre
  les pièces et tranche. L'appeler « KYC » serait exagéré ; le fichier le dit.
- `EXTERNAL_PROVIDER` non configuré : **refuse au lieu de simuler**. Une
  simulation rendant `APPROVED` ferait passer pour vérifié quelqu'un que
  personne n'a vérifié — la faute la plus grave que puisse commettre ce module.

Un webhook reçu sans prestataire engagé n'a aucune signature vérifiable : il est
ignoré, jamais interprété.

## Les pièces

Elles ne sortent jamais d'une réponse publique. La vue vendeur rend leur nature
et leur nombre, pas leur contenu. Toute décision est auditée avec son auteur.

## Ce que V21 demandait et qui n'a pas été renommé

L'énoncé demandait `NOT_STARTED / SUBMITTED / VERIFIED`. Les valeurs
`UNVERIFIED / PENDING / APPROVED` existaient déjà et sont câblées dans les
commandes, les vues, les seeds et les tests : `APPROVED` **est** « vérifié ».
Les renommer aurait touché une centaine d'appels pour un synonyme.

Les trois états qui manquaient vraiment ont été ajoutés : `UNDER_REVIEW` (un
examinateur l'a pris en main), `SUSPENDED` (vérification retirée), `EXPIRED`
(pièces à refournir). Une vérification qui n'est pas `APPROVED` ne crédite
**aucun** point de confiance — c'est vérifié par un test sur les quatre statuts.
