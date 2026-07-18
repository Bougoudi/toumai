# Flux utilisateur principal

Objectif : à partir d'un besoin produit, obtenir une liste classée de fournisseurs
pertinents, puis suivre la mise en relation.

## Parcours nominal

```
 1. Définir le produit            2. Lancer la recherche        3. Analyser les résultats
 ┌──────────────────────┐        ┌──────────────────────┐      ┌──────────────────────┐
 │ Nom, catégorie,      │        │ Critères hérités du  │      │ Fournisseurs classés │
 │ mots-clés, prix      │  ───▶  │ produit (ou libres). │ ───▶ │ par score 0–100 +    │
 │ cible, quantité,     │        │ Synchrone ou en file │      │ détail par critère   │
 │ région, certifs      │        └──────────────────────┘      └──────────┬───────────┘
 └──────────────────────┘                                                 │
                                                                          ▼
 6. Suivi & réévaluation        5. Prise de contact           4. Comparer & sélectionner
 ┌──────────────────────┐        ┌──────────────────────┐      ┌──────────────────────┐
 │ Le worker rafraîchit │        │ Coordonnées du       │      │ Comparer prix, MOQ,  │
 │ prix/stock ; relancer│  ◀───  │ fournisseur          │ ◀─── │ délai, certifs,      │
 │ la recherche         │        │ (email, site, tel)   │      │ réputation           │
 └──────────────────────┘        └──────────────────────┘      └──────────────────────┘
```

## Étapes détaillées

### 1. Définir le produit (optionnel mais recommandé)
`POST /api/products` enregistre le besoin et ses critères cibles (prix, quantité,
région, certifications). Réutilisable pour relancer des recherches sans re-saisir.

### 2. Lancer la recherche
`POST /api/search` :
- avec `productId` → les critères du produit sont repris automatiquement ;
- ou avec des critères libres (`query`, `category`, `keywords`, ...).

Choix du mode :
- **Synchrone** (défaut) : résultats immédiats dans la réponse. Idéal UI temps réel.
- **Asynchrone** (`"async": true`) : réponse 202, traitement par le worker. Idéal
  pour de gros volumes ou des sources lentes.

### 3. Analyser les résultats
Chaque fournisseur est renvoyé avec :
- son **rang** et son **score global** (0–100) ;
- le **détail par critère** (`breakdown`) pour comprendre le classement ;
- la **meilleure offre** associée (prix, MOQ, délai, stock).

### 4. Comparer et sélectionner
L'utilisateur arbitre selon ses priorités (prix vs délai vs certifications). Les
pondérations du moteur sont ajustables côté serveur (`WEIGHTS` dans `scoring.ts`).

### 5. Prise de contact
Le détail fournisseur (`GET /api/suppliers/:id`) expose les coordonnées
(email, site, téléphone) pour engager la mise en relation.

### 6. Suivi et réévaluation
Le job `refreshSuppliers` met à jour périodiquement prix, stock et notes. Relancer
la recherche (ou consulter l'historique via `GET /api/search`) permet de suivre
l'évolution du marché et de réévaluer les fournisseurs.

## Personas

| Persona                | Besoin principal                                         |
| ---------------------- | -------------------------------------------------------- |
| Acheteur / sourcing    | Trouver rapidement des fournisseurs conformes et fiables |
| Responsable achats     | Comparer et arbitrer sur des critères pondérés           |
| Intégrateur technique  | Brancher de nouvelles sources via des connecteurs        |
