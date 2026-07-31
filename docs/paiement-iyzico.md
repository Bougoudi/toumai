# Paiement par carte avec iyzico (Turquie) — « carte → portefeuille → retrait IBAN »

Ce guide explique le mode de paiement voulu :

1. le client paie **par carte** 💳 ;
2. l'argent arrive dans le **portefeuille** de l'appli 💰 ;
3. tu **retires** le solde vers ton **IBAN** 🏦, quand tu veux.

C'est le modèle **iyzico**. iyzico (organisme licencié en Turquie) encaisse et
détient l'argent ; l'appli affiche ton solde et déclenche le retrait. C'est la
**seule façon légale** de « garder l'argent dans l'appli » sans licence bancaire.

---

## 1. Tester tout de suite (bac à sable / sandbox — gratuit, sans document)

1. Crée un compte sandbox gratuit sur **https://sandbox-merchant.iyzipay.com**.
2. Récupère tes clés **API key** et **Secret key** (elles commencent par `sandbox-`).
3. Renseigne dans `.env` :

   ```env
   IYZICO_API_KEY=sandbox-xxxxxxxxxxxxxxxx
   IYZICO_SECRET_KEY=sandbox-xxxxxxxxxxxxxxxx
   IYZICO_URI=https://sandbox-api.iyzipay.com
   PUBLIC_URL=http://localhost:3000
   ```

4. Redémarre l'appli. Sur une commande « en attente », clique **« Payer par carte »** :
   tu es redirigé vers la page de paiement iyzico. Utilise une **carte de test**
   iyzico (ex. `5528 7900 0000 0008`, date future, CVC `123`).
5. Après paiement, iyzico te renvoie dans l'appli, la commande passe **« payée »**,
   et le montant apparaît dans l'onglet **Portefeuille**.

> Le prestataire actif est choisi automatiquement : **iyzico** s'il est configuré,
> sinon Stripe. Pour forcer : `PAYMENT_PROVIDER=iyzico`.

## 2. Retirer vers ton IBAN

Onglet **Portefeuille → « Demander un retrait »** → méthode **Virement bancaire
(IBAN)** → saisis ton IBAN. La demande est enregistrée et suivie dans l'appli.

## 3. Passer en réel (production)

Pour encaisser de **vrais** paiements, il faut un **compte marchand iyzico réel**,
qui nécessite d'être enregistré (une **auto-entreprise / şahıs şirketi** suffit).
Une fois le compte validé :

```env
IYZICO_API_KEY=<ta vraie clé>
IYZICO_SECRET_KEY=<ta vraie clé secrète>
IYZICO_URI=https://api.iyzipay.com
```

**Aucun code à changer** : tu remplaces seulement les clés et l'URI. 🎯

---

## Détails techniques

- **Config** : `src/config/env.ts` (bloc `iyzico`), `src/config/iyzico.ts` (client + helpers).
- **Paiement** : `src/modules/payments/iyzico.service.ts` crée la page hébergée
  (« Checkout Form ») et traite le retour.
- **Aiguillage** : `src/modules/payments/payment.service.ts` choisit iyzico ou Stripe.
- **Callback public** : `POST /api/payments/iyzico/callback` (monté avant l'auth
  dans `src/app.ts`) — iyzico y redirige le navigateur du client avec un `token` ;
  l'appli relit le paiement côté iyzico (source de vérité) avant de marquer la
  commande « payée ».
- **Portefeuille** : le solde disponible se calcule à partir des commandes payées
  (`src/modules/reports/report.service.ts` → `src/modules/wallet`).
