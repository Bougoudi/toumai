# Profil fournisseur : déclaré ≠ observé

> V28 §1, §2. État au 22 septembre 2026.

## Le problème

TOUMA ne peut pas savoir si une boutique fabrique ou revend. Rien dans les
données ne le dit, et l'inventer produirait une donnée fausse sur une fiche
publique.

Seul le fournisseur le sait. Il peut donc le déclarer — et c'est là que
commence le vrai sujet.

Partout ailleurs, TOUMA affiche ce qu'elle **constate** : la capacité vient du
stock saisi, les pays desservis des expéditions réellement faites, les délais
des offres passées. Le profil déclaré est d'une autre nature. Le risque n'est
pas qu'un fournisseur mente : c'est qu'un acheteur ne puisse pas faire la
différence entre

> « a déjà expédié vers le Cameroun »

et

> « dit qu'il pourrait ».

Sur une commande de mille sacs, cette différence est toute la décision.

## Trois décisions de conception

**Une table séparée**, pas des colonnes sur `ToumaStore`. Mélangées aux champs
de la boutique, les déclarations auraient fini par être lues comme le reste.

**`declaredAt` obligatoire.** Une condition commerciale d'il y a deux ans n'est
pas une condition commerciale. La date est repoussée à chaque confirmation et
accompagne l'affichage, pour que l'acheteur en juge lui-même.

**Aucun champ « verified ».** Il n'existe aucun chemin de code par lequel ce
profil rendrait autre chose que `DECLARED`. La vérification vit dans
`ToumaSellerVerification`, avec des pièces justificatives — un fournisseur ne
se vérifie pas lui-même en remplissant un formulaire.

## Dans la réponse

```json
{
  "store": { … },
  "declared": {
    "status": "DECLARED",
    "types": ["MANUFACTURER", "DISTRIBUTOR"],
    "countries": ["TD", "CM"],
    "declaredAt": "…",
    "disclaimer": "Ces informations sont déclarées par le fournisseur lui-même…"
  },
  "servedCountries": []
}
```

Le fournisseur **dit** desservir TD et CM. Il n'a réellement expédié nulle
part. Les deux coexistent sans se mêler, et un test vérifie qu'aucun champ
déclaré ne remonte à la racine de la fiche.

Plusieurs types sont acceptés : un fabricant peut aussi distribuer, et
l'obliger à choisir produirait une donnée fausse.

Les conditions de paiement sont du **texte libre**, pas une structure. TOUMA
n'accorde aucun crédit et n'en tient aucun registre ; structurer « 30 jours fin
de mois » ferait croire que la plateforme suit l'échéance, ce qu'elle ne fait
pas.

## Le garde-fou qui compte

La correspondance (§4) est bâtie sur l'observation. Si une déclaration pouvait
satisfaire un critère, il suffirait de cocher « je livre partout » pour remonter
en tête des résultats — et tout le travail de §4 serait annulé par un
formulaire.

Un test l'interdit : un fournisseur qui a déclaré desservir le Cameroun sans y
avoir jamais expédié garde l'état `NOT_MEASURED` sur ce critère, jamais `MET`.

### Un test qui se dérobait

La première version de ce test cherchait la boutique dans les résultats et
faisait `return` si elle n'y était pas. Elle n'y était jamais — la boutique
n'avait aucun produit — et le test passait donc toujours, sans rien vérifier.
Constaté en injectant la dérive : le test restait vert.

La boutique reçoit maintenant un produit, et l'absence dans les résultats est
un échec. Injecter la même dérive fait désormais échouer le test.

Un test qui se dérobe en silence est pire que pas de test : il donne la
confiance sans la protection.

## Permissions

`PUT /api/v1/sourcing/suppliers/:storeId/profile` — propriétaire de la boutique
uniquement. Un autre vendeur reçoit **404**, jamais 403 : 403 confirmerait
l'existence de la boutique.
