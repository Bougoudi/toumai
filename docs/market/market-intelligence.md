# Intelligence de marché : ce qui est observé, et quand

> V29 §41, §43. État au 26 septembre 2026.

## Ce que l'audit a trouvé

L'essentiel de V29 existait déjà, et bien construit.

`src/touma/ai/insights/demand.service.ts` porte depuis V23 les deux règles que
V29 §3, §4 et §15 demandent :

- **un plancher de volume** (`VOLUME_PLANCHER = 10`) : passer de 1 à 3
  recherches est une hausse de 200 % qui ne veut rien dire ;
- **une fenêtre précédente de même durée**, sinon la comparaison est truquée.

Et l'état `INSUFFICIENT_DATA` est déjà rendu, avec sa phrase : *« Information
non disponible : trop peu de recherches sur la période pour qu'une variation
veuille dire quelque chose. »* L'interdiction de surinterpréter (§15) était
donc tenue avant V29.

Le fichier dit aussi ce qu'il **ne** peut pas mesurer : les vues produit et les
ajouts au panier ne sont pas journalisés dans ce dépôt, et sont nommés comme
absents plutôt que remplacés par un signal approchant. C'est exactement ce que
§34 demande — ne pas fabriquer d'événements historiques.

Deux défauts réels, en revanche, et ce sont les tests critiques 3 et 5 de V29.

## Défaut 1 — un signal géographique ignorait son marché

`unmetDemand()` agrégeait par pays et rendait un code brut :

```json
{ "countryCode": "NG", "searches": 14 }
```

Rien ne distinguait le Tchad, où TOUMA opère, du Nigeria, qui est `PLANNED` :
aucune géographie chargée, aucun prestataire, aucun corridor. Les deux
arrivaient côte à côte dans la même liste, et un lecteur en concluait
naturellement que les deux étaient des marchés.

Quatorze recherches depuis le Nigeria sont une information réelle — quelqu'un
cherche. Mais ce n'est pas de l'activité de marché : c'est de l'intérêt dans un
pays où rien ne peut aboutir. Confondre les deux fait prendre une demande non
servable pour une demande servie, et c'est sur ce genre de confusion qu'on ouvre
un marché trop tôt.

Chaque ligne porte désormais son marché :

```json
{
  "countryCode": "NG",
  "searches": 14,
  "market": {
    "status": "PLANNED",
    "operating": false,
    "statement": "Nigeria n’accepte pas de commandes (PLANNED) : ce signal
                  traduit un intérêt, pas de l’activité de marché — rien ne
                  peut y aboutir aujourd’hui."
  }
}
```

**Rien n'est masqué.** Ç'aurait été l'autre erreur : un pays d'où l'on cherche
sans pouvoir acheter est précisément ce qu'une équipe d'expansion doit voir.

Le statut prime sur les interrupteurs, conformément à V26 §46 : un marché
`SUSPENDED` avec `buyingEnabled: true` n'est pas opérant. Un code pays absent du
référentiel rend `UNKNOWN` — ce n'est pas un marché fermé, c'est un code qu'on
ne reconnaît pas.

## Défaut 2 — aucun signal ne disait son âge

Un tableau de bord affichait « 126 commandes » sans que rien n'indique si le
chiffre datait de dix minutes ou de trois jours. §41 le dit sans détour : *« ne
jamais afficher live si les données ne sont pas live. »*

Un chiffre sans âge se lit comme actuel. **L'absence d'indication est
elle-même une affirmation.**

Quatre états :

| État | Signification |
|---|---|
| `LIVE` | calculé dans la minute |
| `RECENT` | jusqu'à 24 h — encore exploitable pour décider |
| `STALE` | au-delà — rendu quand même, avec son âge |
| `NO_DATA` | il n'y a rien à dater |

**Un signal périmé est rendu, pas masqué.** Le masquer laisserait croire qu'il
n'y a rien à savoir ; périmé et daté vaut mieux qu'absent. La phrase le dit :
*« Trop ancienne pour fonder une décision ; le chiffre est rendu avec son âge,
pas comme un état actuel. »*

Et `NO_DATA` n'est pas zéro. Un produit sans commande observée n'a pas une
demande nulle : il n'a pas de demande mesurée. Les deux mènent à des décisions
opposées.

Deux cas limites couverts par des tests, parce qu'ils se propagent loin : une
observation « dans le futur » (horloge décalée) rend un âge de 0, jamais négatif ;
un horodatage illisible rend `NO_DATA` plutôt que `Invalid Date`.

## Formules

**Fraîcheur** — `age = maintenant − observation la plus récente`, borné à 0.
Seuils : 60 s (`LIVE`), 1 h puis 24 h (`RECENT`), au-delà `STALE`.

**Marché opérant** — `active ET buyingEnabled ET status ∈ {PILOT, ACTIVE,
LIMITED}`. Les trois conditions, pas une seule.

**Tendance** (inchangée, V23) — annoncée seulement si
`courant + précédent ≥ 10`, sur deux fenêtres de même durée, seuil de variation
20 %.

## Ce qui n'est pas fait

V29 demande 60 parties. Cette livraison en couvre deux et constate que §3, §4,
§15 et §34 étaient déjà tenus.

Restent entières : les tables de signaux persistés (§36), le moteur
d'opportunités (§12 à §14, §17), les alertes et listes de surveillance (§28 à
§30), les rapports (§21), la recherche naturelle (§31, §32), le pipeline
observable (§33), les tâches planifiées (§54) et les interfaces (§51 à §53).

Rien n'a été créé en parallèle des services existants : `demand.service.ts`,
`price.service.ts`, `intelligence.service.ts` et `trade/analytics.service.ts`
restent les seuls producteurs de signaux.

---

## Ruptures avec demande observée (§8)

Le journal de mouvements de V27 a rendu possible ce qui manquait : **depuis
quand** un produit est à zéro. La durée est toute l'information — une rupture
de deux heures est un réassort en cours, une rupture de douze jours sur un
produit commandé est une vente perdue tous les jours depuis douze jours.

La date vient du dernier mouvement dont `quantityAfter` vaut 0.

### La limite, dite plutôt que masquée

Le journal n'existe que depuis V27. Une rupture antérieure n'a aucun mouvement,
et sa durée est `UNKNOWN` — **ni zéro, ni « depuis toujours »**. Les deux
seraient faux, et le second ferait paniquer un vendeur sur un article qu'il a
arrêté de vendre il y a six mois.

### Quatre signaux, et un seul est une alerte

| Signal | Condition |
|---|---|
| `HIGH_DEMAND_STOCKOUT` | demande observée **et** durée connue ≥ 1 jour |
| `STOCKOUT_WITH_DEMAND` | demande observée, rupture de moins d'un jour |
| `STOCKOUT_DURATION_UNKNOWN` | durée hors du journal |
| `STOCKOUT` | rupture sans demande notable |

§8 le demande : « seulement si les données le justifient ». Sans durée connue,
on ne sait pas si la rupture dure depuis une heure ; sans demande, une rupture
est une rupture, pas une alerte.

### La demande vient des commandes, pas des recherches

Les recherches sans résultat sont un signal de demande réel (V23), mais un terme
ne se rattache pas de façon fiable à un produit : « sac » peut désigner
quarante références. Les rattacher produirait un chiffre à l'air précis et faux.
Les lignes de commande nomment le produit sans ambiguïté, et comptent les
acheteurs **distincts** — dix unités pour un acheteur et dix pour dix acheteurs
ne disent pas la même chose du marché.

### Une leçon de performance, et une erreur de diagnostic

La première version sélectionnait les produits avec
`inventory: { every: { quantity: { lte: 0 } } }` — un `NOT EXISTS` corrélé
évalué pour chaque produit actif.

Sous la charge parallèle de la suite de tests, **vingt-quatre tests sans rapport
ont échoué** : les transactions de création de produit passaient de 50 ms à
11 600 ms et dépassaient le délai de 5 s de Prisma.

J'ai d'abord conclu que la requête était lente. **Mesurée en isolation, elle
met 146 ms** — pas onze secondes. L'explication exacte est différente : ces
146 ms, répétés sous charge, suffisaient à pousser des transactions concurrentes
au-delà du délai. L'agrégation SQL les ramène à 38 ms et la contention
disparaît ; deux passages complets consécutifs sont verts et les créations
reviennent à ≤ 119 ms.

La requête part désormais de la table d'inventaire, indexée sur `productId`, et
n'examine chaque ligne qu'une fois — ce que §55 demande.

### Un défaut d'ordre dans le contrôle d'accès

Le contrôle de propriété de la boutique arrivait **après** le retour anticipé
« aucune boutique ». Un vendeur sans boutique recevait donc 200 et une liste
vide pour n'importe quel identifiant, là où un vendeur qui en a recevait 404 :
deux réponses différentes à la même tentative, et la seconde apprenait au
premier que le contrôle existe. Le contrôle passe maintenant en premier.
