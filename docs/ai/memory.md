# Mémoire de l'assistant

Bornée par construction, sur trois points.

## 1. Clés fermées

Seules les clés de `CLES_AUTORISEES` peuvent être écrites :

| Clé | Type | Durée |
|---|---|---|
| `budget_max` | PREFERENCE | 180 j |
| `devise` | PREFERENCE | 180 j |
| `province_livraison` | PREFERENCE | 180 j |
| `categories_suivies` | PREFERENCE | 180 j |
| `langue` | PREFERENCE | 180 j |
| `recherche_en_cours` | SESSION | 1 j |
| `produit_consulte` | SESSION | 1 j |
| `boutique_active` | SESSION | 1 j |
| `rfq_en_preparation` | TASK | 30 j |

Une mémoire à clés libres finirait par contenir ce qu'un utilisateur aura
mentionné en passant — un numéro, une adresse, une situation personnelle —
parce que rien ne l'en empêcherait.

Une clé inconnue est **ignorée** plutôt que refusée : l'assistant ne doit pas
s'interrompre parce qu'il a voulu retenir quelque chose qu'on lui interdit de
retenir.

## 2. Expiration obligatoire

Aucune ligne sans date de fin. Une préférence de budget oubliée depuis deux
ans ne doit pas continuer à filtrer les recherches de quelqu'un qui ne s'en
souvient plus. Le travail périodique `memories` purge les lignes expirées.

## 3. Valeurs masquées

`maskPersonalData` passe sur chaque valeur avant écriture, même sous une clé
autorisée.

## Ce que la mémoire ne fait pas

Elle n'écrase jamais ce que l'utilisateur vient de dire. Une préférence ne
s'applique qu'à ce qu'il n'a pas précisé : « je cherche un téléphone » avec un
budget retenu de 60 000 filtre à 60 000 ; « je cherche un téléphone à moins de
200 000 » filtre à 200 000.

## Visible et effaçable

`/touma/ia/conversations` affiche ce qui est retenu, avec sa date
d'expiration, et un bouton pour tout effacer.
