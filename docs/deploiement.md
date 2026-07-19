# 🚀 Mettre Toumai en ligne (application réelle)

Ce guide explique, **pas à pas et sans jargon**, comment passer de la démo à une
**vraie application** utilisable par toi et tes clients, installable sur téléphone.

> **Démo ≠ application réelle**
> - La *démo* (lien Artifact) stocke tout dans le navigateur : c'est juste pour essayer.
> - L'*application réelle*, c'est le code de ce dépôt. Une fois **mise en ligne**, elle
>   a une vraie base de données, de vrais comptes et de vrais paiements Stripe.

---

## 1. Ce qu'il te faut (à créer une fois)

| Élément | Pourquoi | Coût indicatif |
|--------|----------|----------------|
| Un compte **d'hébergement** (Render recommandé) | Faire tourner le serveur 24h/24 | ~7–15 $/mois |
| Un **nom de domaine** (ex. `toumai.app`) | Adresse pro + HTTPS | ~10–15 $/an |
| Un compte **Stripe** | Encaisser les clients + recevoir tes retraits | Commission par vente |
| (Plus tard) comptes **développeur** Google / Apple | Publier sur les stores | 25 $ une fois / 99 $ par an |

Tu n'es **pas** obligé de tout faire d'un coup : tu peux lancer d'abord en PWA,
puis brancher Stripe, puis publier sur les stores.

---

## 2. Déployer en ligne — méthode recommandée (Render)

Render déploie directement depuis GitHub et fournit la base PostgreSQL. Le dépôt
contient déjà tout le nécessaire (`Dockerfile` + `render.yaml`).

1. Crée un compte sur **https://render.com** et connecte ton compte GitHub.
2. Clique **New → Blueprint**, choisis le dépôt **`Bougoudi/toumai`**.
   Render lit `render.yaml` et prépare **2 services** : l'application + la base PostgreSQL.
3. Render te demande de renseigner quelques valeurs :
   - **`PUBLIC_URL`** : laisse d'abord l'adresse fournie par Render
     (ex. `https://toumai.onrender.com`), tu mettras ton domaine ensuite.
   - **`ADMIN_EMAIL`** : ton e-mail → ce sera ton **compte administrateur**.
   - **`ADMIN_PASSWORD`** : un mot de passe fort (≥ 10 caractères).
   - `JWT_SECRET` et `ENCRYPTION_KEY` sont **générés automatiquement** par Render.
4. Clique **Apply / Deploy**. Au premier démarrage, Toumai :
   - crée les tables de la base,
   - crée **ton compte admin** (aucune donnée de démo),
   - démarre le pilote automatique.
5. Ouvre l'adresse fournie → connecte-toi avec ton e-mail / mot de passe. ✅

> **Important — pilote automatique** : garde le plan **« Starter » (toujours actif)**.
> Le plan gratuit se met en veille et interromprait l'automatisation.

---

## 3. Ton nom de domaine + HTTPS

1. Achète un domaine (Namecheap, OVH, Gandi…).
2. Dans Render : **Settings → Custom Domain**, ajoute `toumai.app` (et `www`).
3. Render te donne un enregistrement DNS à copier chez ton registrar.
   Le **certificat HTTPS (cadenas)** est activé automatiquement, gratuitement.
4. Mets ensuite la variable **`PUBLIC_URL`** à `https://toumai.app`.

---

## 4. Activer les paiements et les retraits (Stripe)

1. Crée/active ton compte sur **https://stripe.com** (vérification d'identité de
   ton entreprise requise pour encaisser).
2. Dans Stripe : **Developers → API keys**, copie la **clé secrète** (`sk_live_...`).
3. Dans Render, renseigne **`STRIPE_SECRET_KEY`**.
4. **Webhook** (pour confirmer les paiements) : dans Stripe, **Developers →
   Webhooks → Add endpoint**, URL = `https://TON-DOMAINE/api/webhooks/stripe`,
   événement `checkout.session.completed`. Copie le secret (`whsec_...`) dans
   **`STRIPE_WEBHOOK_SECRET`**.
5. **Retraits (Stripe Payouts)** : dans l'app, onglet **Portefeuille →
   « Connecter Stripe Payouts »**, saisis tes coordonnées bancaires sur la page
   sécurisée Stripe. Ensuite tes retraits partent **automatiquement** vers ta banque.

> Tant que `STRIPE_SECRET_KEY` n'est pas renseignée, l'app reste fonctionnelle mais
> les paiements/retraits sont en mode manuel/démo — rien ne casse.

---

## 5. Connecter Etsy / eBay / Amazon (facultatif)

Depuis l'onglet **Canaux de vente**, chaque marketplace se relie en **OAuth**
(bouton « Autoriser »). Il te faut d'abord créer une application développeur chez
chaque plateforme pour obtenir les identifiants (voir `docs/guide-canaux.md`), puis
les renseigner dans les variables d'environnement correspondantes.

---

## 6. 📱 Installer l'app sur téléphone (aujourd'hui, sans store)

Toumai est une **PWA** : une fois en ligne, elle s'installe comme une vraie app.

- **Android (Chrome)** : ouvre `https://toumai.app` → menu ⋮ → **« Installer
  l'application »** (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : ouvre le site → bouton **Partager** → **« Sur l'écran
  d'accueil »**.

Une icône Toumai apparaît, l'app s'ouvre en plein écran, sans barre de navigateur.
C'est ce que tu partages à tes clients dès maintenant.

---

## 7. 🏪 Publier sur Google Play et l'App Store (ensuite)

La PWA peut être « emballée » en application native :

- **Google Play** : outil **Bubblewrap / PWABuilder** (Trusted Web Activity) →
  génère l'APK/AAB à partir de ton site. Compte développeur Google **25 $** (une fois).
- **Apple App Store** : emballage via **PWABuilder** ou **Capacitor** (WebView) →
  soumission depuis Xcode. Compte développeur Apple **99 $/an**.

Les deux passent par une **validation** (quelques jours). Dis-le-moi quand tu veux
franchir cette étape : je te prépare l'emballage et les fiches.

---

## 8. ✅ Check-list sécurité avant d'ouvrir aux clients

- [ ] `NODE_ENV=production` (le serveur **refuse** de démarrer avec des secrets faibles).
- [ ] `JWT_SECRET` et `ENCRYPTION_KEY` longs et aléatoires (générés par Render).
- [ ] Base **PostgreSQL** (pas SQLite) + **sauvegardes** activées chez l'hébergeur.
- [ ] **HTTPS** actif (cadenas) sur ton domaine.
- [ ] `PUBLIC_URL` = ton vrai domaine `https://...`.
- [ ] **2FA activée** sur ton compte admin (onglet Sécurité) — obligatoire pour les
      actions sensibles (retraits, suppression, changements de sécurité).
- [ ] Clés **Stripe en mode « live »** (`sk_live_...`) quand tu es prêt à vendre.
- [ ] Webhook Stripe configuré et testé.

---

## 9. Autres hébergeurs (alternatives)

- **Railway** (`https://railway.app`) : très simple aussi. Nouveau projet → *Deploy
  from GitHub*, ajoute un plugin **PostgreSQL**, définis les variables (`NODE_ENV`,
  `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `PUBLIC_URL`).
  Le `Dockerfile` est détecté automatiquement. ~5 $/mois.
- **Ton propre serveur (VPS OVH/Hetzner)** : installe Docker, une base PostgreSQL,
  puis `docker build -t toumai . && docker run --env-file .env -p 80:3000 toumai`.
  Mets un reverse-proxy (Caddy/Nginx) pour le HTTPS. Plus de contrôle, plus technique.

---

### Résumé express

1. **Render → Blueprint → dépôt Toumai** → renseigne `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Branche ton **domaine** + **HTTPS**.
3. Ajoute ta **clé Stripe** quand tu veux vendre, connecte **Stripe Payouts** pour tes retraits.
4. Tes clients **installent la PWA** depuis le navigateur.
5. Plus tard : **stores** Google / Apple.
