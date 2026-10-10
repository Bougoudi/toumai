# Avis et modération

## Un avis suppose un achat

Règle antérieure à V21, conservée : seul un acheteur dont la commande est
`DELIVERED` ou `COMPLETED` peut noter, une seule fois par couple
commande/produit, et seulement un produit figurant dans cette commande.

## Les états

`PENDING` · `PUBLISHED` · `HIDDEN` · `REJECTED` · `FLAGGED`

C'était une chaîne libre commentée « PENDING | PUBLISHED | REJECTED ». L'enum
la remplace et ajoute les deux états qui manquaient : masqué après publication,
et signalé en attente d'une décision humaine.

La migration correspondante a dû être réécrite à la main. Prisma proposait
`DROP COLUMN "status"` puis `ADD COLUMN` : tous les avis déjà modérés seraient
repassés à `PUBLISHED`, y compris ceux qu'un administrateur avait rejetés. Une
conversion en place les conserve.

## Les signaux de manipulation

| Signal | Points | Ce qui est constaté |
|---|---|---|
| `LINKED_TO_SELLER` | 40 | même compte, ou téléphone partagé avec le vendeur |
| `BURST_FROM_AUTHOR` | 25 | plus de 5 avis du même compte en 24 h |
| `CONTACT_DETAILS` | 25 | coordonnées dans le texte — c'est du démarchage |
| `IMMEDIATE_AFTER_DELIVERY` | 20 | moins de 10 minutes après livraison |
| `SINGLE_STORE_AUTHOR` | 20 | 4 avis ou plus, une seule boutique |
| `EXTREME_WITHOUT_TEXT` | 10 | 1 ou 5 sans un mot |

Recommandation : `ALLOW` (< 20) · `FLAG` (≥ 20) · `REVIEW` (≥ 40) · `HOLD` (≥ 60).

## Ce qui n'est pas regardé

**Ni adresse IP, ni empreinte d'appareil.** L'énoncé les mentionnait « si
légalement approprié ». TOUMA ne les collecte pas, personne n'a examiné la
question au Tchad, et la minimisation des données tranche dans l'autre sens tant
que ce n'est pas fait. Les signaux ci-dessus n'en ont pas besoin.

## Le moteur signale, il ne masque pas

Un avis au-dessus du seuil passe en `FLAGGED` et **reste lisible** jusqu'à ce
qu'un humain décide. Le masquer sur un score probabiliste serait une sanction
automatique, et un avis sincère effacé par une heuristique coûte plus cher à la
confiance qu'un faux avis laissé quelques jours de plus.

La décision de modération exige un motif et est auditée.

## L'auteur n'est pas prévenu

La réponse au dépôt d'un avis ne contient plus son statut de modération. Dire à
quelqu'un « votre avis a été signalé » lui apprend qu'il a été repéré ; lui dire
pourquoi lui apprend comment passer au travers la prochaine fois.
