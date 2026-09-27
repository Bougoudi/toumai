# Architecture de Touma Intelligence

## La forme réelle

```
Écran (/touma/ia · /vendeur/ia · /business/ia · /admin/ia)
  │
  ▼
Route Express  ──►  Assistant (agents/agent.ts)
                      │
                      ├─► Planificateur (agents/intent.ts)  — quoi aller chercher
                      ├─► Exécuteur d'outils (tools/runner.ts)
                      │      └─► Outils ──► services métier ──► PostgreSQL
                      ├─► Passerelle (gateway.ts) ──► fournisseur ──► modèle (si configuré)
                      └─► Rédacteur (agents/composer.ts)  — mise en phrases
```

Le cahier des charges décrit NestJS, Redis et BullMQ. Le dépôt est un
monolithe modulaire **Express + Prisma + PostgreSQL 16**, sans Redis ni
BullMQ. V23 est bâti sur cette pile : les travaux périodiques s'accrochent au
planificateur d'entretien existant, et les abstractions (fournisseur
d'embeddings, index de recherche) sont écrites pour qu'un OpenSearch ou un
pgvector se branche plus tard sans toucher aux appelants.

## Les deux règles qui tiennent le reste

**1. Le modèle n'est jamais source de vérité.** Un prix, un stock, une
commande, un paiement viennent de PostgreSQL par un service métier. Le modèle
met en phrases ce que les outils ont lu ; il n'ajoute pas de faits. Les
chiffres affichés à l'écran sont produits par le rédacteur à partir des
résultats d'outils, jamais par un modèle.

**2. Le modèle n'exécute rien de sensible.** Il propose ; un humain confirme.
Le niveau de risque d'un outil décide si cette confirmation est exigée, et ce
n'est pas au modèle d'en juger.

## Le passage obligé

`gateway.ts` est le seul chemin vers un fournisseur. Y sont appliqués, dans
cet ordre : coupe-circuit de fonctionnalité, plafonds d'usage, détection
d'injection, minimisation des données, routage, repli, trace.

Un seul chemin, parce qu'une garantie qui dépend de la discipline de chaque
appelant n'est pas une garantie. Un développeur qui ajoute demain une
fonctionnalité d'IA n'a pas sept règles à se rappeler : il appelle la
passerelle, et les sept s'appliquent.

## L'héritage du contrôle d'accès

C'est le résultat le plus utile de l'audit : **les services métier portent
déjà le contrôle d'accès**. `orderService.get(user, id)` lève `notFound` pour
la commande d'un autre ; `productService.requireOwned` lève `forbidden` pour
le produit d'un autre vendeur.

Un outil IA n'exécute donc jamais sa propre requête Prisma. Il appelle le
service, avec l'objet `ToumaRequestUser` de celui qui parle. La couche IA
**hérite** du contrôle au lieu de le réécrire. Une escalade de privilège par
outil supposerait un service déjà percé — auquel cas l'API l'est sans IA.

Le contre-exemple, celui qu'on ne trouvera pas dans ce code : un outil qui
ferait sa propre requête « pour aller plus vite » créerait un second chemin
d'accès aux données, avec ses propres oublis.

## Fichiers

| Fichier | Rôle |
|---|---|
| `ai.types.ts` | contrat des fournisseurs, cinq méthodes, capacités déclarées |
| `registry.ts` | registre, routage de modèle, décision de repli |
| `gateway.ts` | le passage obligé |
| `injection.ts` | détection d'injection d'invite |
| `privacy.ts` | minimisation avant envoi à un tiers |
| `usage.service.ts` | comptabilité et plafonds |
| `confirmation.service.ts` | confirmation humaine des actions sensibles |
| `memory.service.ts` | mémoire bornée, à clés fermées |
| `evaluation.service.ts` | qualité, signalements, coûts |
| `jobs.ts` | travaux périodiques, idempotents par fenêtre |
| `tools/` | registre d'outils et leurs implémentations |
| `agents/` | planificateur, rédacteur, assistant |
