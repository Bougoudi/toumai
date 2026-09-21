# Observabilité

## Ce qui existe réellement

| Élément | État |
|---|---|
| Journal structuré JSON | **réel** (`src/utils/logger.ts`) |
| Identifiant de requête propagé | **réel** (`src/middleware/request-context.ts`) |
| Journal d'accès (méthode, route, statut, durée) | **réel** |
| Codes d'erreur dans les réponses | **réel** |
| Rédaction des secrets dans les journaux | **réel** (`src/touma/lib/redact.ts`) |
| Collecteur de métriques (Prometheus…) | **absent** |
| Alertes | **absentes** |
| Agrégateur de journaux | **absent** — les journaux vont sur la sortie standard |

Rien ici ne prétend qu'une supervision est en place. Il n'y en a pas : les
journaux sont écrits sur la sortie standard et c'est à l'hébergement de les
collecter.

## Identifiant de requête

Chaque requête reçoit un identifiant, renvoyé dans l'en-tête `x-request-id` et
présent dans **toute** réponse d'erreur (`requestId`). C'est le numéro qu'une
personne cite au support.

Un `x-request-id` fourni par l'appelant est conservé s'il respecte
`^[A-Za-z0-9._-]{8,128}$` — un proxy qui trace déjà garde sa trace. Sinon il
est remplacé : une valeur libre finirait dans le journal, où elle serait relue
comme du JSON, et permettrait d'y fabriquer de fausses entrées.

L'identifiant est porté par `AsyncLocalStorage`, donc **aucune signature de
fonction n'a changé** : une ligne de journal écrite au fond du service de
paiement porte l'identifiant de la requête HTTP qui l'a déclenchée. Vérifié en
exécution : un webhook mal signé produit la ligne métier « signature invalide »
et la ligne d'accès sous le même identifiant.

Un travail sans requête — tâche planifiée — reçoit son propre contexte via
`avecContexte(origine, …)`, préfixé par son origine. Il n'emprunte pas
l'identifiant d'une requête qui passait par là.

## Journal d'accès

Une ligne par requête terminée : `method`, `route`, `statusCode`,
`durationMs`, `requestId`, `userId` si authentifié.

`route` est le **gabarit** (`/api/v1/products/:id`), jamais l'URL réelle : un
chemin porte des identifiants de commande et de compte, et un journal d'accès
n'en a pas besoin pour dire ce qui est lent.

Portée exacte : une route reconnue, même imbriquée, voit ses paramètres
masqués ; un chemin non reconnu (404) garde son segment brut, faute de
gabarit — ce sont des balayages, qu'on veut voir. Une ressource appartenant à
quelqu'un d'autre correspond bien à une route (le 404 est celui de
l'anti-IDOR) et reste donc masquée.

Les sondes `/health` et `/ready` ne sont pas journalisées : interrogées toutes
les trente secondes, elles noieraient le reste.

## Réponses d'erreur

```json
{ "error": "…", "code": "AUTH_FORBIDDEN", "requestId": "…", "details": { } }
```

`error` est conservé — c'est le champ que lisent l'application web, la vitrine
et la suite de tests. `code` s'ajoute pour ce qu'un programme doit décider.

Aucun code n'est jamais absent : à défaut de code métier précis, le statut HTTP
en fournit un (`SYSTEM_NOT_FOUND`, `AUTH_REQUIRED`…). Les codes métier
spécifiques (`PAYMENT_*`, `TRADE_*`…) s'ajoutent au cas par cas ; ils ne sont
**pas** encore posés sur l'ensemble des appels, et prétendre le contraire
rendrait le catalogue de codes faux dès sa première lecture.

En production, ne sortent jamais : pile d'appels, erreur SQL, chemin interne,
secret. Le détail va dans le journal avec l'identifiant de requête.

## Ce qu'il faudrait ensuite

- Un collecteur de métriques (§16-17) : rien n'est instrumenté aujourd'hui.
- Des alertes (§50) : elles supposent un collecteur.
- Un agrégateur de journaux : dépend de l'hébergement retenu.
