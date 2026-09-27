# Données personnelles

## Export (§67)

`POST /api/v1/auth/me/export` rend, en une réponse, ce que le compte détient :
identité, adresses, commandes et leurs lignes, avis, boutiques, fidélité,
préférences de notification, demandes de suppression.

L'export nomme aussi ce qu'il **ne contient pas** — messages reçus d'autrui,
journaux techniques et d'audit, pièces de vérification d'identité. Un export
muet sur ses limites laisse croire qu'il est exhaustif.

Les montants restent des chaînes décimales. L'appel est limité en débit et
tracé dans le journal d'audit.

### Écart assumé avec la consigne

§67 demande « job asynchrone, archive sécurisée, URL temporaire ». Ce dépôt
n'a **ni file d'attente ni stockage objet garanti** : construire un faux
travail asynchrone et une fausse URL temporaire donnerait l'apparence de la
chose sans la chose. L'export est donc synchrone et rendu dans la réponse.

Le jour où un stockage objet sera configuré, l'archive hors ligne devient
possible — et c'est à ce moment-là qu'elle doit être écrite, pas avant.

## Suppression de compte (§68)

`POST /api/v1/auth/me/delete-request`.

### Ce n'est pas une suppression, c'est une anonymisation

La consigne est explicite : ne jamais supprimer automatiquement ce que la
comptabilité et l'audit exigent, ne pas supprimer aveuglément.

| Ce qui reste | Pourquoi |
|---|---|
| commandes, lignes, paiements | faits commerciaux ; le vendeur garde la preuve de ce qu'il a vendu |
| écritures du grand livre | comptabilité |
| documents commerciaux | obligations fiscales et douanières |
| journal d'audit | sécurité |

| Ce qui part |
|---|
| nom, courriel, téléphone |
| adresses, panier, favoris |
| notifications et préférences |
| mémoires d'assistance, réponses enregistrées |
| toutes les sessions, immédiatement |

**L'identifiant du compte est conservé.** Le remplacer casserait chaque
référence `SetNull` déjà posée et transformerait une anonymisation en perte de
données pour les autres.

### Délai de réflexion

Trente jours, annulables à tout moment. Le délai protège de deux choses : le
regret, et un compte pris en main par quelqu'un d'autre qui s'effacerait avec
ce qu'il a fait.

### Ce qui bloque

Une demande est refusée, avec le motif, tant que subsiste :

- une commande en cours côté acheteur — effacer l'identité rendrait la
  livraison impossible ;
- une vente en cours dans une de ses boutiques ;
- un versement en attente — effacer le compte effacerait le destinataire des
  fonds ;
- un litige ouvert — son instruction a besoin des parties.

Les blocages sont **revérifiés à l'échéance** : une commande a pu naître
pendant les trente jours. Une demande bloquée reste alors en attente avec son
motif, ni exécutée ni silencieusement abandonnée.

## Ce qui reste à décider

La **durée de conservation légale au Tchad** n'est pas codée, parce que
personne dans ce dépôt ne la connaît. Un délai inventé serait pire qu'un délai
absent : il donnerait l'apparence d'une conformité que rien n'étaye.

C'est une des questions juridiques à trancher avant la mise en service, au
même titre que celles de `docs/payments/compliance-boundaries.md`.
