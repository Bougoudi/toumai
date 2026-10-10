# Prestataires par marché

## Ce que cela remplace

Le prestataire de paiement était **une variable d'environnement unique** :
`TOUMA_PAYMENT_PROVIDER`, globale à l'instance. Une plateforme présente au
Tchad et au Cameroun ne peut pas fonctionner ainsi — les opérateurs de monnaie
mobile, les transporteurs et les passerelles SMS diffèrent d'un pays à l'autre,
et un contrat signé dans l'un ne vaut pas dans l'autre.

`ToumaCountryProvider` porte la relation **marché × métier × prestataire**.

## La règle

On ne sélectionne jamais un prestataire qui ne peut pas rendre le service :

- ni un **adaptateur de simulation** — il répond à tout, y compris à ce que
  personne ne peut faire, et le laisser être choisi transformerait une absence
  de prestataire en apparence de service ;
- ni un prestataire **qui n'est pas `ACTIVE`** sur ce marché ;
- ni un prestataire qui **ne couvre pas le moyen demandé** — un opérateur de
  monnaie mobile n'encaisse pas un paiement à la livraison.

Quand il n'y en a aucun, la sélection rend `null` **et le motif**. Un appelant
qui reçoit `null` sans explication finit par inventer la sienne.

## L'ordre est déterministe

Priorité croissante, puis code alphabétique. Un choix qui change d'une requête
à l'autre rend un incident irreproductible — et c'est précisément quand tout va
mal qu'on a besoin de le rejouer.

Les suivants sont rendus comme relais (`fallbacks`). Suspendre le premier fait
passer le second, sans configuration supplémentaire.

## Aucun secret en base

`configuration` est destiné aux **identifiants publics** : un nom de marchand,
une URL de rappel, un identifiant d'expéditeur SMS.

Une clé d'API dans une colonne `Json` de PostgreSQL se retrouve dans les
sauvegardes, les journaux de réplication et les exports d'administration —
exactement ce que V25 §4 interdit. Le refus est **actif**, pas documenté : une
vérification récursive rejette toute clé dont le nom évoque un secret
(`secret`, `password`, `apiKey`, `token`, `private`, `credential`,
`signature`, `salt`), y compris enfouie dans un objet imbriqué.

Les clés et jetons restent dans l'environnement du serveur.

## Santé

Trois états, et le troisième compte :

| État | Signification |
|---|---|
| `HEALTHY` | une sonde réelle a répondu |
| `UNHEALTHY` | une sonde réelle a échoué |
| `NEVER_CHECKED` | aucune sonde n'a tourné |

« Jamais vérifié » n'est **pas** « en panne ». Les confondre ferait passer pour
défaillant un prestataire que personne n'a encore interrogé — et basculer sur un
relais sans raison.

Seule `noterSante()` écrit ces champs, et seulement depuis une sonde réelle.

## Ce que le registre contient aujourd'hui

| Marché | Métier | Prestataire | État | Réel ? |
|---|---|---|---|---|
| TD | PAYMENT | `mock` | ACTIVE | **non — simulation** |
| TD | SHIPPING | `mock` | ACTIVE | **non — simulation** |
| CM | SHIPPING | `mock` | ACTIVE | **non — simulation** |

Trois lignes, aucun prestataire réel. Elles figurent malgré tout : taire un
adaptateur de simulation ne le ferait pas disparaître, et il vaut mieux qu'il
soit là, signalé, que de laisser croire qu'il n'y a rien.

C'est pourquoi le contrôle de préparation rend `BLOCKED` sur `payments`,
`refunds`, `payouts` et `shipping` pour les deux marchés.
