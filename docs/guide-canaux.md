# Guide : connecter Etsy / eBay / Amazon (pour de vrai)

Toumai gère tout le flux OAuth. Vous n'avez qu'à créer une **app développeur**
chez la plateforme, y coller l'URL de redirection, puis cliquer **« Autoriser »**.

> URL de redirection à enregistrer partout : **`https://VOTRE-DOMAINE/api/oauth/callback`**
> (en local : `http://localhost:3000/api/oauth/callback`). WebAuthn/OAuth exigent
> **HTTPS** en production.

## Etsy (le plus simple)

1. Allez sur **Etsy Developers → Create a New App** (https://www.etsy.com/developers).
2. Notez le **Keystring** (c'est votre *client ID*).
3. Dans « Callback URLs », ajoutez `https://VOTRE-DOMAINE/api/oauth/callback`.
4. Dans Toumai : **Canaux de vente → Connecter un canal → Etsy**, saisissez le
   **Keystring** et votre **Shop ID**, puis **Enregistrer, puis autoriser**.
5. Vous êtes redirigé vers Etsy → autorisez → retour dans Toumai (canal **Connecté**).

## eBay

1. **eBay Developers Program** (https://developer.ebay.com) → créez une application
   (clés de **production**).
2. Récupérez **App ID (Client ID)** et **Cert ID (Client Secret)**.
3. Configurez un **RuName** (redirect) pointant vers `…/api/oauth/callback`.
4. Créez vos **politiques** de vente (fulfillment / payment / return) et notez leurs IDs,
   plus un **merchant location key**.
5. Dans Toumai : **Connecter → eBay**, saisissez ces champs, **autorisez**.

## Amazon (le plus exigeant)

1. Compte vendeur **Professionnel** + inscription **SP-API** validée par Amazon
   (Seller Central → Développeur). Cela peut prendre plusieurs jours.
2. Créez une app SP-API : notez **Application ID**, **LWA Client ID/Secret**.
3. Renseignez **Marketplace ID** (ex : `A13V1IB3VIYZZH` pour Amazon.fr), **Seller ID**,
   **région** (`eu`).
4. Dans Toumai : **Connecter → Amazon**, saisissez ces champs, **autorisez**
   (consentement SP-API).

## Ce qui se passe ensuite

- Toumai **importe automatiquement** les commandes des canaux connectés (toutes les
  5 min, et à chaque cycle du pilote) → achat fournisseur → expédition.
- Vous pouvez **publier un produit** en annonce depuis le catalogue.
- Les jetons sont **chiffrés** et **rafraîchis automatiquement** ; vous n'avez rien
  à re-saisir tant que l'autorisation n'est pas révoquée côté plateforme.
