# Documents commerciaux

## Ce que Touma émet, ce qu'elle ne fait que recevoir

C'est la distinction qui structure tout le module.

**Émis par Touma** — elle en détient les données :
facture commerciale, proforma, liste de colisage, bon de commande.

**Reçus seulement** — ils viennent d'un tiers :
certificat d'origine, document de transport, autre.

Un certificat d'origine vient d'une chambre de commerce ou d'une
administration. Le fabriquer serait un faux au sens propre (§17, §69). Il ne
peut être que téléversé, puis vérifié.

## Ce que les documents ne portent pas, écrit dans les documents

La facture commerciale porte une rubrique `notIncluded` : droits de douane et
taxes à l'importation, taxes de vente relevant du régime fiscal du vendeur. Un
document commercial muet sur ses propres limites laisse croire qu'il les
couvre.

**Aucune taxe n'est calculée** (§14) : Touma ne connaît ni le régime fiscal du
vendeur, ni les obligations du pays de destination.

## Liste de colisage : aucune dimension inventée

Le poids vient des produits, qui le portent. **Les dimensions ne sont pas
saisies dans Touma** : elles sont rendues nulles, et le document dit qu'elles
manquent. Une liste de colisage aux dimensions fabriquées fait refuser un
chargement à la frontière.

## Un document téléversé n'est pas un document vérifié

Il entre en `UPLOADED`. Le marquer `VERIFIED` à l'arrivée viderait la
vérification de son sens.

La vérification est réservée à l'administration, et **la méthode employée est
consignée** : c'est elle qui fait la valeur de la vérification, pas le drapeau.
Un rejet porte obligatoirement son motif.

## Confidentialité

`storageKey` — le chemin du fichier privé — ne sort **jamais** d'une réponse
d'API. L'exposer contournerait l'URL signée. Acheteur, vendeur et
administrateur seuls accèdent à un document ; les autres reçoivent
« introuvable », la même réponse que pour un document inexistant, afin qu'un
document commercial ne se laisse pas deviner par sondage d'identifiants.

## Numérotation

`FC-2026-000123` pour une facture commerciale, `PF` pour une proforma, `LC`
pour une liste de colisage. Unique en base. Une facture commerciale ne se
réémet pas : deux numéros pour une même transaction rendraient la comptabilité
du vendeur incohérente.
