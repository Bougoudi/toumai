# Sécurité de l'assistant

## Le contrôle d'accès n'est pas réécrit

Chaque outil appelle un service métier avec l'objet utilisateur de celui qui
parle. Le service refuse. La couche IA n'a pas de règle d'accès propre, parce
qu'une seconde implémentation aurait ses propres oublis.

Vérifié par test :

- l'acheteur A ne lit pas la commande de l'acheteur B — et reçoit la même
  réponse que pour une commande inexistante, pour ne pas révéler qu'elle
  existe ;
- le vendeur A ne lit pas les ventes du vendeur B ;
- un acheteur n'exécute pas un outil d'administration ;
- un administrateur sur la surface acheteur n'atteint pas un outil
  d'administration — surface et rôle sont deux contrôles indépendants ;
- un visiteur n'atteint pas les outils qui demandent un compte ;
- un visiteur ne reprend pas la conversation d'un utilisateur connecté ;
- un utilisateur ne lit pas la conversation d'un autre ;
- on ne signale que les messages qu'on a reçus.

## Ce que l'assistant ne fait jamais seul

Paiement, remboursement, versement au vendeur, confirmation de commande,
restriction d'un vendeur, publication d'un produit, envoi d'une demande de
devis. Chacun exige une confirmation humaine explicite, portée par
`ToumaAiActionConfirmation`.

Les paramètres exécutés sont **relus depuis la base**, jamais repris de la
requête de confirmation : sinon il suffirait de faire valider un texte à
l'écran et d'en exécuter un autre. Une confirmation ne couvre qu'un outil
nommé, et ne s'exécute qu'une fois.

## Refus propres

Un refus du service métier — 403, 404 — remonte tel quel : c'est lui qui
décide, et son message est le bon. Toute autre erreur est rendue générique :
un message d'exception de base de données n'a rien à faire dans une
conversation avec un acheteur.

Le corps d'erreur d'un fournisseur d'IA ne remonte pas non plus — il peut
contenir l'invite renvoyée en écho, donc des données d'utilisateur. Seul le
code de statut est conservé.

## Ce qui ne sort pas

- `providerInfo()` énumère ses drapeaux un par un. La première écriture
  diffusait `env.touma.ai` en bloc sur une route publique, donc `AI_API_KEY`.
  Un test échoue désormais sur tout champ dont le nom ressemble à un secret.
- `redactForPublic` masque les composantes internes d'un score de confiance,
  dont le signal de fraude du vendeur.
- Une adresse complète n'est jamais rendue dans une carte de commande.
