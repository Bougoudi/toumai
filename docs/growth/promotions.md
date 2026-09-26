# Promotions

## Une promotion n'est pas un coupon

Un coupon s'applique parce qu'on a tapé un mot. Une promotion s'applique parce
que le panier remplit des conditions. L'acheteur n'a rien à savoir pour en
bénéficier — c'est ce qui la rend utile, et aussi ce qui la rend dangereuse si
elle s'applique là où elle ne devrait pas.

## Les règles

Douze genres, stockés en **structure** : seuil, liste de valeurs, négation.

`MIN_ORDER_AMOUNT` · `MIN_QUANTITY` · `PRODUCT` · `CATEGORY` · `SELLER` ·
`COUNTRY` · `PROVINCE` · `FIRST_ORDER` · `NEW_CUSTOMER` · `CUSTOMER_SEGMENT` ·
`MIN_STOCK` · `MAX_STOCK`

**Pas d'`eval()`.** Une règle commerciale stockée en chaîne puis évaluée, c'est
une exécution de code arbitraire déguisée en paramètre : quiconque peut écrire
une promotion peut alors écrire du code.

**Une règle d'un genre inconnu ne passe pas.** L'ignorer reviendrait à appliquer
la promotion en sautant la condition qui la limitait — exactement l'inverse de
ce qu'on veut d'une montée de version ratée.

**Toutes les règles doivent être remplies.** Un ET, jamais un OU implicite : un
OU se modélise par deux promotions, ce qui reste lisible.

### Deux refus délibérés

- **Province inconnue → la règle de province n'est pas remplie.** Deviner
  accorderait une promotion locale à une livraison dont on ignore la
  destination.
- **Stock inconnu → la règle de stock n'est pas remplie.** Supposer le stock
  suffisant ferait tourner une promotion sur un article épuisé, et l'acheteur
  découvrirait la rupture après avoir cliqué.

## Le cumul

1. Une promotion `EXCLUSIVE` gagne seule et **écarte tout**, y compris un code
   saisi.
2. Sinon, **une seule** `NON_STACKABLE` s'applique : la plus prioritaire.
3. Les `STACKABLE` s'ajoutent.

**À priorité égale, la plus avantageuse pour l'acheteur.** Le contraire lui
demanderait de comprendre un ordre interne pour savoir pourquoi il a eu la
moins bonne des deux ; le vendeur qui ne le veut pas règle la priorité.

Les promotions écartées **ne disparaissent pas** : elles sont rendues avec la
raison de leur mise à l'écart. Un acheteur qui voit « −10 % dès 25 000 XAF » et
ne l'obtient pas a le droit de savoir qu'il lui manque 2 000 XAF, plutôt que de
croire à une panne.

## Qui finance

| Financement | Effet |
|---|---|
| `PLATFORM` | TOUMA paie ; le vendeur est réglé plein tarif |
| `SELLER` | le vendeur réduit son revenu, et la commission assise dessus |
| `PARTNER` | **refusé** tant qu'aucun partenariat n'est signé |

Un vendeur ne peut créer que des promotions de **ses** boutiques, et elles sont
forcément `SELLER` : le service lie `storeId` et `funding`. Sans ce lien, un
vendeur écrirait des promotions payées par TOUMA, et rien dans l'écran ne le lui
interdirait.

Une promotion de boutique ne porte **que** sur cette boutique. Lui laisser le
panier entier ferait payer à un vendeur la remise d'un autre.

## Le budget

`spent` n'est jamais écrit par une lecture suivie d'une écriture : l'incrément
est **conditionnel en SQL**.

```sql
UPDATE touma_promotion_budgets
   SET spent = spent + :montant
 WHERE "promotionId" = :id
   AND (spent + :montant) <= total
```

Zéro ligne mise à jour signifie « l'enveloppe ne le permet plus » ; la promotion
est alors suspendue pour les paniers suivants. Une campagne à fort trafic
déborde exactement au moment où elle coûte le plus cher — c'est le seul moment
où la protection compte.

Le budget est consommé **après** la création des commandes et sans les faire
échouer : si l'enveloppe vient d'être épuisée par une commande concurrente, la
remise de celle-ci a déjà été affichée. La refuser rétroactivement serait
changer un prix après l'avoir montré.

## Les garde-fous

- pourcentage borné à 0–100, montant fixe strictement positif ;
- montant fixe **sans devise refusé** — il s'appliquerait à n'importe quelle
  monnaie, et il n'existe pas de taux officiel ici ;
- remise jamais supérieure à ce sur quoi elle porte, total jamais négatif ;
- fin après le début ;
- une promotion **archivée ne se réactive pas** : des commandes s'y réfèrent, et
  les rouvrir changerait rétroactivement ce qui a été facturé.
