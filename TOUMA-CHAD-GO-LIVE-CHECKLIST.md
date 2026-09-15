# TOUMA Tchad — liste de vérification avant mise en service

Cette liste sert à décider **si l'on peut ouvrir**, pas à se rassurer. Chaque
ligne est vérifiable ; une ligne qu'on ne peut pas cocher honnêtement est une
ligne qui bloque, ou une fonction qu'on n'affiche pas.

La règle qui gouverne tout le reste :

> **Ne jamais déclarer disponible ce qui ne l'est pas.** Pas de « paiement
> disponible » sans prestataire réel, pas de « livraison disponible » sans zone
> configurée, pas de « vendeur vérifié » sans vérification réelle.

Légende : ☐ à faire · ⛔ bloquant · ⚠️ à décider avant d'ouvrir

---

## Base de données

- ☐ ⛔ `npx prisma migrate deploy` passe sur la base de production, **sans
  `db push`** — l'historique des migrations doit être intact.
- ☐ ⛔ `npx prisma migrate status` annonce zéro migration en attente.
- ☐ ⛔ Sauvegarde quotidienne **configurée et restaurée au moins une fois** sur
  une base jetable (`docs/backup-and-recovery.md`). Une sauvegarde jamais
  restaurée est un fichier, pas une sauvegarde.
- ☐ Rétention décidée : 30 jours de copies quotidiennes, 12 mois de mensuelles.
  Un litige peut s'ouvrir longtemps après la vente.

## Données géographiques

- ☐ ⛔ `SELECT count(*) FROM touma_provinces WHERE "countryCode"='TD'` rend
  **23**.
- ☐ Les 133 départements sont présents.
- ☐ Le fait que les localités ne soient **pas** rattachées à leur département est
  connu de l'équipe produit — le filtre par département sera pauvre, et ce n'est
  pas un bogue (`docs/chad-geography-sources.md`).
- ☐ Provinces où l'on n'ouvre pas encore : **désactivées**, jamais supprimées.
- ☐ Attribution GeoNames (CC BY 4.0) visible quelque part dans le produit ou ses
  mentions légales.

## Sécurité

- ☐ ⛔ `JWT_SECRET`, `TOUMA_ACCESS_SECRET` et tout secret générés pour la
  production (`openssl rand -base64 48`) — **aucune valeur d'exemple**.
- ☐ ⛔ Aucun secret dans Git. Vérifier l'historique, pas seulement le dernier
  commit.
- ☐ ⛔ HTTPS de bout en bout, redirection HTTP active.
- ☐ ⛔ Ports PostgreSQL et Redis **non publiés** (`docker-compose.prod.yml`
  s'en charge). Une base exposée est trouvée par balayage en quelques heures.
- ☐ Limitation de débit active sur l'authentification.
- ☐ Comptes de démonstration (`admin@touma.dev`, etc.) **supprimés** de la base
  de production.
- ☐ Rôles vérifiés : un acheteur ne lit pas la commande d'un autre, un vendeur ne
  lit pas la vente d'un autre. Les tests le couvrent ; le vérifier une fois à la
  main sur la production ne coûte rien.

## Paiement

- ☐ ⛔ `TOUMA_PAYMENT_PROVIDER` **n'est pas `mock`**, ou bien le paiement n'est
  pas proposé du tout. Un client final ne doit jamais voir « paiement simulé ».
- ☐ ⛔ `TOUMA_PILOT_MODE=false`.
- ☐ ⚠️ Prestataire Mobile Money choisi, contractualisé, identifiants en place.
- ☐ Webhook du prestataire : URL déclarée, **signature vérifiée**, rejeu testé
  (un webhook rejoué ne doit jamais être appliqué deux fois).
- ☐ Un paiement réel de bout en bout a été fait, puis **remboursé**, sur le
  compte de production.
- ☐ **Paiement à la livraison** : si `TOUMA_COD_ENABLED=true`, au moins une règle
  existe (pays, province ou boutique) avec un plafond décidé. Sans règle, il
  reste fermé — c'est voulu.
- ☐ Les vendeurs qui encaisseront du liquide savent qu'ils doivent **constater**
  la remise dans l'application, sans quoi la vente n'entre jamais au registre.

## Transport

- ☐ ⛔ `TOUMA_LOGISTICS_PROVIDER=zones` en production. Le mock facture et date
  toutes les destinations à l'identique.
- ☐ ⛔ **Au moins une zone configurée** par province ouverte, avec prix et délais
  **fournis par un transporteur réel** — pas estimés au jugé.
- ☐ Provinces non desservies déclarées `UNSERVED` plutôt que laissées sans zone,
  pour que le message à l'acheteur soit clair.
- ☐ L'interface affiche « Estimation indisponible » là où aucune zone ne répond,
  et non un délai de repli.
- ☐ ⚠️ Décidé : qui remet les colis en point relais, et comment cette personne
  accède au code de retrait (aujourd'hui, seul le vendeur ou l'administration
  peut valider une remise).

## SMS et e-mail

- ☐ `TOUMA_EMAIL_ENABLED` cohérent avec un prestataire réellement configuré.
- ☐ ⚠️ Opérateur SMS choisi, ou `TOUMA_SMS_ENABLED=false` et **aucune promesse de
  SMS** dans l'interface.
- ☐ Un e-mail de test reçu, non classé en indésirable (SPF, DKIM, DMARC).
- ☐ Aucun jeton ni lien privé dans le corps d'un e-mail.

## Assistance

- ☐ ⛔ `TOUMA_SUPPORT_PHONE` et `TOUMA_SUPPORT_EMAIL` renseignés **et répondus
  par un humain**. Un numéro affiché qui sonne dans le vide fait plus de dégâts
  que pas de numéro du tout.
- ☐ Horaires d'assistance affichés, en heure de N'Djamena.
- ☐ Quelqu'un est désigné pour traiter les litiges escaladés. L'escalade porte le
  dossier devant un humain ; s'il n'y a pas d'humain, elle ne fait rien.

## Vendeurs et produits

- ☐ Processus de vérification **réellement opéré** — sinon ne pas afficher
  « vendeur vérifié ».
- ☐ Au moins un vendeur actif par province ouverte, sans quoi la page de
  province est vide et le promet quand même.
- ☐ Catalogue relu : aucun produit de démonstration en production.
- ☐ Prix et stocks vérifiés par les vendeurs eux-mêmes.

## Commandes, retours, litiges

- ☐ Un achat complet réalisé en production : commande → paiement → expédition →
  suivi → livraison.
- ☐ Un retour et un remboursement réels menés à leur terme.
- ☐ Un litige ouvert, une pièce versée, une décision rendue — pour vérifier que
  le dossier est lisible et que la pièce s'ouvre réellement.
- ☐ ⚠️ Décidé : ouvrir un litige fait passer la commande « en litige », ce qui
  retire le bouton de demande de retour. Est-ce le comportement voulu ?

## Performance et réseau

- ☐ Parcours d'achat essayé sur un téléphone Android **en 3G**, pas seulement au
  bureau en fibre.
- ☐ Images compressées ; aucune page ne charge des centaines de produits d'un
  coup.
- ☐ Temps de réponse de l'API mesuré depuis le Tchad, pas depuis l'hébergeur.

## Mobile

- ☐ Parcours complet vérifié à 360, 390 et 430 px.
- ☐ Aucun débordement horizontal, aucune erreur console.
- ☐ Application installable, et page hors ligne qui explique la situation.

## Supervision

- ☐ `/health` et `/ready` branchés sur la sonde de l'hébergeur — `/ready`, pas
  `/health`.
- ☐ Alerte en cas d'erreurs répétées ou de base injoignable.
- ☐ Journaux consultables, et **aucun secret dedans** : ni mot de passe, ni
  jeton, ni donnée bancaire.

## Juridique et conformité

- ☐ ⚠️ Statut de l'exploitant au Tchad établi.
- ☐ ⚠️ **Régime de TVA** : aucun n'est configuré aujourd'hui, et les documents
  commerciaux l'annoncent. À trancher avec un conseil avant d'émettre des
  factures à grande échelle.
- ☐ ⚠️ Traitement des données personnelles : durée de conservation, droit
  d'accès, droit d'effacement.
- ☐ Conditions générales et politique de confidentialité publiées et
  accessibles depuis l'application.
- ☐ ⚠️ Obligations de conservation comptable. Le registre de la plateforme
  **n'est pas une comptabilité légale**, et la documentation le dit.

---

## Décision d'ouverture

Une mise en service n'est pas un interrupteur. L'ordre qui limite les dégâts :

1. **Une province** — N'Djamena — avec une poignée de vendeurs connus.
2. Un mode de paiement, un mode de livraison, **tous deux réels**.
3. Deux semaines d'observation : litiges, retours, appels à l'assistance.
4. Puis ouvrir province par province, en configurant les zones à mesure.

Les drapeaux de fonctionnalité (`TOUMA_*_ENABLED`) sont faits pour cela. Un
drapeau à `true` **n'ouvre rien** par lui-même : il autorise. Si le prestataire
n'est pas configuré, la fonction reste fermée — et c'est la bonne façon de se
tromper.
