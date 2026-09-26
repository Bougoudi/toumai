# Secret fuité, accès suspect

## Contenir d'abord

L'ordre compte : contenir, puis comprendre. Comprendre d'abord laisse la porte
ouverte pendant l'enquête.

### Secret de jetons (`JWT_SECRET`) compromis

1. Le remplacer et redéployer. Toutes les sessions tombent — c'est l'effet
   recherché : un jeton forgé avec l'ancien secret ne vaut plus rien.
2. Prévenir : chacun devra se reconnecter.

### Secret de webhook compromis

Le remplacer **des deux côtés**, chez le prestataire et ici. Entre les deux,
les notifications sont rejetées : c'est préférable à des notifications forgées.

### Compte d'administration compromis

1. `POST /auth/me/sessions/:id/revoke` pour l'appareil identifié, ou
   déconnexion de tous les appareils pour une coupure immédiate.
2. Retirer ses permissions (`PUT /admin/permissions/:id`) — plus rapide que de
   suspendre le compte, et tracé.
3. Lire `/admin/audit` filtré sur cet acteur : tout geste sensible y figure
   avec l'avant et l'après.

## Comprendre ensuite

- `/admin/audit` : qui, quoi, quand, depuis quelle adresse.
- Journal d'accès : `userId` et `requestId` relient les requêtes entre elles.
- `/admin/webhooks` : tentatives rejetées, avec leur origine.

## Notifier

Les obligations de notification au Tchad ne sont **pas** connues de ce dépôt.
Elles font partie des questions juridiques à trancher. Ne rien inventer ici :
un délai de notification inventé est pire qu'un délai absent.

## Après

Écrire ce qui s'est passé pendant que c'est frais, y compris ce qui a mal
fonctionné dans la réaction. Un compte rendu qui ne dit que ce qui a bien
marché ne sert à personne.
