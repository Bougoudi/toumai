# Intégrité des données

## Ce que fait ce contrôle

Dix invariants du modèle, exprimés en SQL, exécutés à la demande depuis
`GET /api/v1/admin/data-integrity` (permission `ADMIN_SYSTEM`).

| Code | Invariant | Gravité |
|---|---|---|
| `ORDER_WITHOUT_ITEMS` | toute commande porte au moins une ligne | critique |
| `ORDER_TOTAL_MISMATCH` | `total = subtotal + shippingTotal − discountTotal` | critique |
| `ORDER_PAID_WITHOUT_PAYMENT` | une commande au-delà de `PENDING` s'appuie sur un paiement réussi, sauf paiement à la livraison | critique |
| `PAYMENT_SUCCEEDED_ORPHAN` | un paiement réussi désigne une commande existante | critique |
| `INVENTORY_NEGATIVE` | ni quantité ni réservation négative | critique |
| `INVENTORY_OVER_RESERVED` | on ne réserve pas plus d'unités qu'il n'en existe | anomalie |
| `LEDGER_SALE_WITHOUT_COMMISSION` | une vente s'accompagne d'une commission sur la même référence | anomalie |
| `LEDGER_ORPHAN_STORE` | une écriture appartient à une boutique existante | anomalie |
| `SHIPMENT_ORPHAN` | une expédition désigne une commande existante | critique |
| `DELIVERED_WITHOUT_SHIPMENT` | une commande livrée a laissé une trace d'expédition | anomalie |

## Trois règles

**Tout passe par SQL.** Un balayage en mémoire sur les premières lignes
trouverait ce qu'il croise et manquerait le reste en silence — exactement le
défaut qu'un contrôle d'intégrité ne doit pas avoir. Une tâche antérieure
n'inspectait que les 500 premiers produits et déclarait le stock sain.

**Rien n'est réparé.** Constater et réparer sont deux gestes ; le second
demande une décision humaine (§84), et un outil de réparation n'existe pas
encore.

**« Sain » se mérite.** Le rapport rend `checked` — le nombre d'invariants
réellement contrôlés — et ne dit jamais `HEALTHY` si une requête a échoué :
un nom de table erroné passerait sinon pour un contrôle effectué (§89).

## Ce que le premier passage a trouvé

101 lignes d'inventaire à `reserved = -1` en base de test, aucune en base de
développement : une réservation libérée plus de fois qu'elle n'avait été
prise.

Portée exacte, après vérification : la disponibilité à la vente se calcule sur
`quantity`, déjà décrémentée au checkout. **Un `reserved` négatif ne fait donc
pas survendre** ; il fausse un compteur de suivi, et toute somme construite
dessus avec lui.

Trois chemins libèrent une réservation — annulation, expiration, réception
d'un retour — et aucun n'avait de plancher. `libererReservation()` les
remplace tous les trois et emploie `GREATEST(reserved − n, 0)` : une
libération excédentaire devient sans effet au lieu de creuser.

Cela empêche la conséquence. **La cause** — lequel des trois chemins libère
deux fois — n'est pas établie, et c'est écrit ici plutôt que passé sous
silence. Le contrôle `INVENTORY_NEGATIVE` le signalera si cela recommence ;
il ne le peut plus, désormais, que par un chemin d'écriture direct.
