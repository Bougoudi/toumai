# Risque et fraude

## Deux niveaux, et ils ne se ressemblent pas

**Le risque d'un compte** (`ToumaRiskScore`, antérieur à V21) agrège des
signaux sur 30 jours : échecs de paiement, comptes partageant un téléphone,
incohérence entre pays du compte et pays de livraison, volume inhabituel. Il
n'exclut jamais personne à lui seul.

**Le risque d'une transaction** (`ToumaTransactionRisk`) évalue une commande au
moment où elle est passée, et conserve la trace de ce que la plateforme savait
quand elle a laissé passer.

## La règle qui commande tout

Un score probabiliste **ne bloque jamais** une commande.

Une décision `BLOCK` n'est rendue que par une **règle nommée portant sur un fait
certain** :

| Règle | Fait |
|---|---|
| `ACCOUNT_BANNED` | le compte est banni |
| `ACCOUNT_SUSPENDED` | le compte est suspendu |
| `STORE_INACTIVE` | la boutique n'est plus ouverte |

Tout le reste module une décision douce : `ALLOW`, `REQUIRE_VERIFICATION`,
`HOLD` (le versement attend), `REVIEW` (un humain relit).

**Pourquoi cette distinction n'est pas théorique.** Un acheteur de N'Djamena qui
commande pour la première fois, de nuit, un article cher, chez un vendeur récent,
coche quatre facteurs sans rien faire de mal. Le bloquer, c'est perdre un client
honnête ; retenir le versement le temps de la livraison protège tout le monde
sans accuser personne.

Le message rendu à l'acheteur cite **la règle**, pas le score : « votre compte
ne peut pas passer commande » est contestable, « score de risque 82 » ne l'est
pas.

## Les facteurs

`BUYER_RISK_SIGNALS` 25 · `UNUSUAL_AMOUNT` 20 · `BRAND_NEW_ACCOUNT` 15 ·
`UNVERIFIED_NEW_SELLER` 15 · `CASH_ON_DELIVERY` 10 · `CROSS_BORDER` 10 ·
`NEW_SHIPPING_ADDRESS` 5

Niveaux : `LOW` (< 25) · `MEDIUM` (≥ 25) · `HIGH` (≥ 50) · `CRITICAL` (≥ 75).

## Ce qui n'est pas mesuré est dit

Le moyen de paiement n'est pas connu au passage de commande : TOUMA crée la
commande d'abord, le paiement ensuite. Le facteur `CASH_ON_DELIVERY` n'est donc
pas mesuré à ce moment — il n'est **pas supposé absent**. Supposer qu'il n'y a
pas de paiement à la livraison noterait la transaction plus sûre qu'elle n'est.

## Le pays, et seulement pour ce qu'il détermine

`CROSS_BORDER` regarde si le colis franchit une frontière, parce qu'un colis qui
en franchit une passe par plus de mains. Ce n'est pas un jugement sur l'acheteur,
et la province n'entre nulle part dans un score de personne.

## Ce qui reste interne

Les signaux de fraude ne sortent d'aucune réponse publique. La composante
correspondante du score est rendue **opaque** : les points restent — sans quoi
le total ne s'additionnerait plus et le score cesserait d'être vérifiable — mais
le motif disparaît.

Un acheteur voit un score plus bas sans qu'on lui dise de quoi le vendeur est
soupçonné. Publier une suspicion interne sur une fiche publique, c'est publier
une accusation non établie.

Le vendeur lui-même ne reçoit pas le détail : il voit que des contrôles internes
lui coûtent des points et peut contester, sans apprendre quelles règles
contourner.
