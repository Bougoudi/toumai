# Les notifications de paiement n'arrivent plus

## Reconnaître

- Des paiements restent `PENDING` alors que les acheteurs disent avoir payé.
- `/admin/webhooks` : plus aucune réception récente, ou des rejets en série.

## Trois causes, trois remèdes

### 1. Signature refusée

Le journal porte `INVALID_SIGNATURE`. Causes possibles, par ordre de
fréquence :

- **le routeur des webhooks a été monté après un analyseur de corps.** C'est
  arrivé : la signature est alors vérifiée sur une re-sérialisation du corps,
  dont les octets diffèrent de ceux que le prestataire a signés, et *toutes*
  ses notifications sont rejetées comme falsifiées. Le routeur refuse
  désormais explicitement un corps déjà analysé, avec un message qui nomme la
  cause ;
- le secret de signature a changé d'un côté seulement ;
- quelqu'un tente réellement d'en forger.

Les trois se distinguent par l'origine consignée avec chaque tentative.

### 2. Horodatage hors fenêtre

`STALE`. Vérifier l'horloge du serveur avant d'incriminer le prestataire : une
dérive d'horloge produit exactement ce symptôme.

### 3. Le prestataire n'émet plus

Rien n'arrive, aucun rejet. Consulter sa console : la plupart réémettent, et
l'anti-rejeu empêche les doublons.

## Ne pas faire

Confirmer les paiements à la main pour « débloquer ». Sans notification, on ne
sait pas si l'argent est arrivé.
