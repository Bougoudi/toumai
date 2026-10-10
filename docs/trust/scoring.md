# Comment le score est calculé

Tout ce qui suit est **publié par l'API** (`GET /api/v1/trust/weights`), sans
compte. Ce n'est pas de la transparence de communication : un vendeur qui ne
peut pas reconstituer son score ne peut pas le contester, et un score
incontestable n'est pas une mesure — c'est une sentence.

## Les composantes

### Vendeur

| Composante | Poids | Mesure |
|---|---|---|
| `VERIFICATION` | +20 | niveau en cours de validité |
| `DELIVERY` | +20 | taux de livraisons dans le délai annoncé |
| `TRANSACTIONS` | +20 | commandes livrées / 50 |
| `REVIEWS` | +15 | note moyenne / 5 |
| `CANCELLATION` | +15 | 1 − taux d'annulation après paiement |
| `RESPONSIVENESS` | +10 | taux de réponse aux messages |
| `DISPUTES` | **−15** | taux de litige / 10 % |
| `FRAUD_SIGNALS` | **−30** | score de risque du compte / 100 |

Les positifs somment à 100 : un vendeur irréprochable peut atteindre 100. Un
maximum inatteignable serait un plafond invisible que personne ne comprend.

### Acheteur

`COMPLETED_ORDERS` +35 · `PAYMENT_RELIABILITY` +25 · `ACCOUNT_AGE` +15 ·
`VERIFIED_CONTACT` +10 · `NO_ABUSE` +15 · `CANCELLATIONS` −20 ·
`FRAUD_SIGNALS` −30

**Aucune variable de personne.** Ni nationalité, ni origine, ni genre, ni
religion — et la garantie n'est pas une promesse : la requête qui mesure un
acheteur **ne sélectionne pas ces colonnes**. La donnée n'entre pas dans le
calcul. La province non plus : elle sert à livrer, pas à juger quelqu'un.

Un test le verrouille en comparant la liste complète des composantes : un ajout
futur fait échouer la suite au lieu de passer inaperçu.

### Produit et fournisseur

Produit : `SELLER_TRUST` +35 · `ORDER_VOLUME` +25 · `REVIEWS` +25 ·
`LOW_RETURNS` +15 · `RETURNS` −20.

Fournisseur B2B : `VERIFICATION` +25 · `QUOTE_RESPONSE` +25 ·
`QUOTE_ACCEPTANCE` +20 · `B2B_ORDERS` +20 · `RESPONSE_SPEED` +10 ·
`DISPUTES` −20.

Le score fournisseur est distinct du score vendeur, et pas par symétrie : un bon
vendeur au détail peut être un fournisseur médiocre. Répondre à un appel
d'offres, tenir un délai annoncé, honorer un devis ne se mesurent nulle part
ailleurs.

## Deux règles asymétriques, et l'asymétrie est le point

**Une composante positive non mesurée ne pénalise pas.** Les poids sont
renormalisés sur ce qui a pu être mesuré. Un vendeur sans conversation n'a pas
« 0 de réactivité » : il n'est pas noté dessus. Compter un zéro reviendrait à
inventer une mauvaise note.

**Une pénalité non mesurée vaut zéro, pas une renormalisation.** La renormaliser
augmenterait le poids des autres pénalités parce qu'il en manque une — donc
punirait plus fort pour moins de faits.

## Sous le seuil, le score vaut `null`

Pas zéro. `null`.

| Entité | Volume minimal |
|---|---|
| vendeur | 5 commandes livrées |
| acheteur | 3 commandes terminées |
| produit | 5 commandes |
| fournisseur | 3 offres |

Un vendeur nouveau n'est pas un mauvais vendeur, et l'interface doit pouvoir
dire « pas encore assez de commandes » plutôt qu'afficher 12/100. La ventilation
est rendue quand même : l'absence de score ne dispense pas de dire ce qui a été
regardé.

## Décroissance temporelle

Le poids d'un fait est multiplié par `0.5 ^ (âge / 180 jours)`, nul au-delà de
730 jours. À six mois il compte pour moitié, à un an pour un quart.

Un litige d'il y a deux ans ne dit pas grand-chose d'un vendeur d'aujourd'hui,
et le faire peser autant qu'un litige de la semaine dernière condamnerait
quiconque s'est corrigé.

**L'historique n'est jamais supprimé.** C'est le poids qui décroît, pas la
trace : une décision prise il y a trois ans doit rester relisible, notamment si
elle est contestée.

## Ce que le score n'est pas

Une garantie. « EXCELLENT » ne veut pas dire qu'une transaction ne peut pas mal
se passer, et l'interface ne doit jamais le laisser croire. C'est un repère de
lecture construit sur du passé.
