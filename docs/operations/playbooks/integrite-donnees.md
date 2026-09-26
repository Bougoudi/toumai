# Un contrôle d'intégrité passe au rouge

## Reconnaître

`/admin/data-integrity` ou `npm run check:production` signale des lignes.

## Avant tout : le contrôle a-t-il tourné ?

Le rapport porte `checked` (nombre d'invariants contrôlés) et `failures`
(requêtes en échec). Une requête en échec **n'est pas** un contrôle réussi, et
le rapport ne dit jamais `HEALTHY` dans ce cas. Vérifier `failures` avant les
`issues`.

## Ne rien réparer dans la précipitation

Constater et réparer sont deux gestes. Aucun outil de réparation n'existe, et
c'est délibéré : une correction en masse sur des données financières se décide,
se prépare et se trace.

## Par contrôle

| Code | Première question |
|---|---|
| `ORDER_WITHOUT_ITEMS` | une transaction interrompue en plein milieu ? |
| `ORDER_TOTAL_MISMATCH` | une remise appliquée hors du calcul ? |
| `ORDER_PAID_WITHOUT_PAYMENT` | des notifications perdues (voir `webhooks.md`) ? |
| `PAYMENT_SUCCEEDED_ORPHAN` | une commande supprimée à la main ? |
| `INVENTORY_NEGATIVE` | une réservation libérée deux fois |
| `LEDGER_SALE_WITHOUT_COMMISSION` | une règle de commission modifiée en cours de route ? |
| `SHIPMENT_ORPHAN` | un import ou une reprise manuelle ? |

## Méthode

1. Relever les identifiants donnés en exemple — le rapport en rend dix, jamais
   la liste entière.
2. Lire les lignes concernées **avant** toute écriture.
3. Chercher la cause. Corriger les symptômes laisse la cause produire d'autres
   symptômes.
4. Toute correction passe par une transaction et laisse une trace d'audit.

## Cas déjà rencontré

`INVENTORY_NEGATIVE` sur des lignes à `reserved = -1` : trois chemins
libéraient une réservation sans plancher. La disponibilité se calculant sur
`quantity`, cela **ne faisait pas survendre** — cela faussait un compteur de
suivi. Le plancher est désormais posé ; la cause exacte du double appel reste
à établir, et ce contrôle la signalera si elle se reproduit.
