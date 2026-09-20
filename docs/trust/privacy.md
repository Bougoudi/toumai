# Confiance et vie privée

## Ce qui est public, et pourquoi

Score, ventilation, badges, indicateurs de performance, statut et niveau de
vérification. Tout cela est public **parce qu'un acheteur en a besoin pour
décider avant d'acheter**, y compris sans compte — c'est justement ce qui
l'aide à décider de s'inscrire.

## Ce qui ne l'est jamais

| Donnée | Qui y accède |
|---|---|
| pièces de vérification | le vendeur propriétaire, l'équipe de revue |
| signaux de fraude | l'administration |
| motif **interne** d'une sanction | l'administration |
| pièces d'une décision | l'administration |
| adresse complète | les parties à la commande |

## Trois choses que l'intéressé ne voit pas non plus

1. **Le détail des contrôles internes qui le pénalisent.** Il voit qu'ils lui
   coûtent des points et peut contester. Lui donner les règles reviendrait à
   publier le mode d'emploi du contournement.
2. **Qu'un de ses avis a été signalé.** Le lui dire apprend à un faux avis
   comment passer au travers.
3. **Le motif interne d'une sanction.** Il reçoit le motif communiqué, qui est
   obligatoire et qui suffit à contester.

Cette opacité a une limite claire : elle ne couvre **jamais** ce qui est
reproché ni la façon de contester. C'est la différence entre protéger un
dispositif et se protéger d'un recours.

## Minimisation

TOUMA ne collecte ni adresse IP ni empreinte d'appareil pour la détection de
fraude sur les avis. L'énoncé les autorisait « si légalement approprié » —
personne n'a examiné la question au Tchad, et tant que ce n'est pas fait, la
minimisation tranche dans l'autre sens. Les signaux retenus n'en ont pas besoin.

## Journaux

Aucune décision de confiance n'écrit de donnée personnelle dans les journaux
applicatifs : identifiants et codes, jamais noms, adresses ni pièces. La
redaction existante (`src/touma/lib/redact.ts`) s'applique.

## Conservation

Les instantanés de score et les badges retirés **ne sont pas supprimés**. Une
décision contestée trois ans plus tard doit rester relisible. La question de la
durée de conservation applicable au Tchad rejoint celles de
`docs/payments/compliance-boundaries.md` — elle attend le conseil juridique,
et ce document ne la tranche pas.
