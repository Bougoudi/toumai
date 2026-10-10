# Centre de confiance — administration

## Tableau de bord

`GET /api/v1/admin/trust/overview` — vendeurs vérifiés, dossiers en attente,
comptes à risque élevé, avis signalés, sanctions actives, recours ouverts,
répartition des scores vendeurs par palier.

Tous sont des décomptes réels issus de la base. Aucun n'est estimé.

## Les files

| Route | File |
|---|---|
| `GET /admin/trust/reviews?status=FLAGGED` | avis à relire, avec leurs signaux |
| `GET /admin/trust/risk?level=HIGH` | transactions évaluées à risque |
| `GET /admin/trust/appeals` | recours en attente |
| `GET /verification/queue` | dossiers de vérification (V13) |

## Les décisions

| Route | Effet | Exigence |
|---|---|---|
| `POST /admin/trust/reviews/{id}/moderate` | publier, masquer, rejeter un avis | motif |
| `POST /admin/trust/appeals/{id}/decide` | trancher un recours | motivation ≥ 10 caractères |
| `POST /admin/trust/users/{id}/standing` | restreindre, suspendre, bannir, rétablir | motif communiqué |
| `POST /admin/trust/recompute/{type}/{id}` | recalculer une confiance | — |

Toutes sont réservées au rôle `ADMIN`, toutes sont auditées.

## Ce qu'un administrateur ne peut pas faire

- **Écrire un score, un badge ou un statut de vérification directement.** Aucune
  route ne l'expose. Un recalcul repart des faits ; si le score est faux, ce sont
  les faits qu'il faut corriger.
- **Se sanctionner lui-même.**
- **Sanctionner sans motif communiqué.**
- **Rejuger un recours déjà tranché.**

## Lire un score contesté

1. `GET /trust/history/{entityType}/{entityId}` — la suite datée, avec le motif
   de chaque mouvement et l'écart.
2. L'instantané porte la ventilation complète telle qu'elle était **ce jour-là**.
3. Chaque composante cite le décompte qui l'a produite.

C'est ce qui permet de répondre « votre score a baissé le 12 mars, à l'ouverture
d'un litige sur la commande TM-… » plutôt que « votre score a baissé ».
