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

## Centre d'opérations (§53, §86)

`GET /api/v1/admin/operations` (permission `ADMIN_SYSTEM`).

C'est l'écran qu'on regarde à trois heures du matin pour décider s'il faut
réveiller quelqu'un. Une case verte pour une chose que personne ne mesure y
est plus dangereuse qu'une case rouge.

Trois sections, et trois règles :

| Section | Contenu |
|---|---|
| `infrastructure` | PostgreSQL, Redis, stockage objet, recherche, file d'attente |
| `providers` | paiement, transporteurs, assistance IA, taux de change |
| `notInstrumented` | sauvegardes, métriques, alertes, travaux périodiques |

**Rien n'est déduit d'un fichier de configuration.** Chaque ligne vient d'une
sonde exécutée à l'instant ou d'un état lu en base. Un adaptateur nommé dans
la configuration n'est pas un service qui répond — c'est la distinction que
§89 impose, et la première version de cet écran l'a manquée : elle affichait
« Assistance IA : OK — prestataire "mock" configuré ». Un test l'attrape
désormais, sur l'ensemble des prestataires.

**Ce qui n'est pas mesuré est écrit comme tel** (`NON_INSTRUMENTE`), jamais
rendu en vert. Confondre « rien de cassé » et « rien de surveillé » est ce qui
fait rater un incident.

**L'état global ne peut pas être meilleur que sa pire ligne critique.** Une
anomalie d'intégrité critique, ou PostgreSQL injoignable, rendent l'ensemble
`CRITICAL`.

L'écran remonte aussi deux dettes plutôt que de les taire : le nombre
d'administrateurs encore non cadrés, et l'absence de sauvegarde — nommée comme
un bloqueur de mise en service, avec la mention que la perte serait définitive.

## Dégradation gracieuse, mise à l'épreuve (V25 §51-52, §74)

`tests/integration/chaos-degradation.test.ts` provoque de vraies pannes
plutôt que de relire la documentation. La règle vérifiée est toujours la
même : **ne jamais simuler une réussite**.

| Panne provoquée | Comportement exigé |
|---|---|
| un transporteur lève à chaque appel | les autres répondent ; aucune ligne ne porte son code |
| **tous** les transporteurs enregistrés lèvent | refus franc, sans montant ni délai dans le message |
| Redis absent ou injoignable | l'instance reste prête ; Redis n'est jamais requis |
| aucun modèle d'IA configuré | réponse rendue, et `source.realProviderConfigured: false` |

Le deuxième test est le plus important, et le plus difficile à écrire
honnêtement. Deux prémisses fausses de ma part ont dû être corrigées avant
qu'il ne prouve quoi que ce soit :

1. viser une destination inexistante ne prouve rien — le transporteur de
   simulation accepte **toute** destination et produit un tarif par formule.
   C'est sa nature, et c'est pourquoi `check:go-live` refuse une ouverture au
   public tant qu'il est le seul enregistré ;
2. un transporteur ajouté par un test précédent répondait encore. Le registre
   n'offre pas de retrait ; on neutralise donc par écrasement, avec un
   transporteur qui ne se déclare candidat nulle part.

Le test est éprouvé dans les deux sens : en ajoutant un tarif de secours
inventé dans le service, il échoue.

Les transporteurs sont **rendus** après l'essai, et un test le vérifie : ce
registre est partagé par le processus, et un essai qui casse la logistique
pour les suivants transforme une panne simulée en panne réelle.
