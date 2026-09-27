# TOUMA Trust — ce qui bloque la mise en service

Ce document ne liste pas des idées d'amélioration. Il liste ce qui empêche
aujourd'hui d'annoncer certaines choses à un utilisateur réel.

## Bloquant : dépend d'une décision ou d'un contrat

| Ce qui manque | Ce qui est bloqué | Qui décide |
|---|---|---|
| **fournisseur SMS** | `PHONE_CONFIRMED`, donc « téléphone vérifié » | vous |
| **prestataire KYB ou accès registre** | `COMPANY_REGISTRY`, donc `ENTERPRISE` | vous |
| **PSP** | `PAYOUT_ACCOUNT`, donc `ENTERPRISE` | vous |
| **conseil juridique** | durée de conservation des pièces de vérification | vous |

Tant que ces quatre lignes tiennent, le niveau `ENTERPRISE` est **inatteignable
par construction** et l'API le dit. Ce n'est pas un défaut à corriger dans le
code : c'est une honnêteté à tenir jusqu'à ce que le contrat existe.

## Bloquant : dépend de données réelles

**Les seuils n'ont jamais vu un vendeur tchadien.** « 50 livraisons pour une
antériorité pleine », « 10 % de litiges pour une pénalité entière », « 4 heures
pour un vendeur réactif » sont des valeurs de départ, pas des mesures. Elles se
règlent par variable d'environnement précisément parce qu'elles devront bouger
après les premières semaines d'exploitation.

Les publier avant de les avoir calibrées est assumé : un seuil public et faux
est corrigible ; un seuil caché et faux ne l'est pas.

## Non bloquant, mais à savoir

- **Le recalcul est différé** (balayage toutes les 5 minutes). Un score peut
  donc être en retard de quelques minutes sur un fait. Il n'y a ni reprise après
  échec ni garantie d'exécution — acceptable ici parce que chaque score se
  recalcule depuis des faits en base, jamais depuis un cumul d'incréments.
- **Pas de cache Redis.** `TOUMA_TRUST_TTL_SECONDS` borne les recalculs à la
  lecture ; un cache partagé n'apportera quelque chose qu'à un volume qui
  n'existe pas encore.
- **Un recours approuvé ne lève pas la sanction automatiquement.** Voir
  `appeals.md` — c'est un choix.
- **Le classement de recherche intègre la confiance**, et un test vérifie que
  rien dans le tri ne regarde une promotion, une mise en avant ou un paiement.
  Le contrôle porte sur le **code du tri** plutôt que sur un résultat : un jeu
  de données ne prouverait rien, alors qu'un terme acheté y laisserait une
  trace. Le jour où une mise en avant payante existera, elle devra être une
  liste **séparée et étiquetée**, jamais un pouce sur cette balance.
- **Un fournisseur sans score passe derrière un score mesuré, devant rien.**
  Il n'est ni pénalisé comme un mauvais fournisseur, ni avantagé par son
  absence de mesure.

## Vérifications avant d'ouvrir

```bash
npm test                    # dont trust-scoring, trust, trust-risk, trust-api
npm run typecheck
curl localhost:3000/api/v1/trust/weights | jq .verification.unavailableSignals
```

La dernière commande doit rendre les trois signaux indisponibles tant qu'aucun
prestataire n'est engagé. Si elle rend une liste vide sans qu'un contrat ait été
signé, quelque chose ment.
