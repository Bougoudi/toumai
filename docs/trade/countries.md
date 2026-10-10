# Configuration des pays

## Deux notions distinctes

`Country` porte l'**identité** d'un pays : nom, devise, indicatif
téléphonique, fuseau horaire, ouverture à l'achat et à la vente. Elle existait
avant V24 et n'a pas changé.

`ToumaTradeCountryConfig` porte sa **capacité commerciale** : le pays
échange-t-il à l'international, avec quelles devises, quels moyens de
paiement, quels transporteurs, quels documents.

Les fondre ferait dépendre l'existence d'un pays de sa capacité commerciale,
alors qu'un pays peut parfaitement exister dans le référentiel sans commercer
à l'international.

## Jamais supposer qu'un prestataire est partout

C'est la règle du §6, et elle a une conséquence concrète : les moyens de
paiement sont déclarés **par pays**, et la capacité d'un corridor est
l'intersection des deux côtés. Un moyen disponible au Tchad et pas au Cameroun
ne permet pas de payer un vendeur camerounais.

## Adresses

Le modèle d'adresse africain existait déjà avant V24 et satisfait le §63 :
pays, province, département, sous-préfecture, localité, quartier, point de
repère, destinataire, téléphone — et **code postal facultatif**.

Rien n'a été ajouté. Un second modèle d'adresse aurait ses propres oublis.

## Téléphone

L'indicatif vient de `Country.dialCode` : `+235` pour le Tchad, `+237` pour le
Cameroun. La validation suit la configuration du pays, jamais une liste codée
en dur.

## Ajouter un pays

1. Créer la ligne `Country` — nom, devise, indicatif, fuseau.
2. Charger sa géographie si le pays doit être livrable en détail.
3. `PUT /admin/trade/countries/:code` pour sa capacité commerciale.
4. Créer les corridors voulus, dans chaque sens.

Rien de tout cela n'ouvre le commerce : il faut encore un prestataire de
paiement et un transporteur réels, et l'activation les vérifie.
