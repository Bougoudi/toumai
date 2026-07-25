# 🏪 Publier Toumai sur Google Play et l'App Store

Toumai est une **PWA** : on la « emballe » en application native pour les stores.
La partie **technique est déjà prête** dans le dépôt (manifeste, icônes *maskable*,
service worker, service des *asset links* Android). Il te reste les étapes qui
exigent **tes comptes développeur** (identité + paiement) — que personne ne peut
faire à ta place.

> **Prérequis** : l'application doit d'abord être **en ligne en HTTPS**
> (voir `docs/deploiement.md`). Les stores emballent une URL réelle.

---

## Méthode la plus simple : PWABuilder (aucun outil à installer)

**https://www.pwabuilder.com** génère les paquets Android **et** iOS à partir de
ton URL. Pas besoin d'Android Studio ni (presque) de Xcode.

1. Va sur PWABuilder, saisis `https://TON-DOMAINE`, clique **Start**.
2. PWABuilder analyse ta PWA (manifeste, service worker, icônes) — Toumai est déjà
   conforme (score élevé attendu).
3. Section **Package For Stores** → choisis la plateforme.

### 🤖 Google Play (Android — TWA)

1. Dans PWABuilder → **Android → Generate Package**.
2. Note le **nom de package** (ex. `app.toumai.twa`) et télécharge le `.zip`.
   Il contient l'`AAB` (à envoyer au store) **et** un fichier
   `assetlinks.json` avec les **empreintes SHA-256** de ta clé de signature.
3. **Relie l'app au domaine** : copie ces empreintes dans les variables
   d'environnement de ton hébergeur (Render) :
   ```
   ANDROID_PACKAGE_NAME=app.toumai.twa
   ANDROID_SHA256_FINGERPRINTS=AB:CD:...:EF   # une ou plusieurs, séparées par des virgules
   ```
   Toumai sert alors automatiquement `https://TON-DOMAINE/.well-known/assetlinks.json`
   → plus de barre d'adresse, l'app s'ouvre en plein écran natif. ✅
4. Crée un compte **Google Play Console** (**25 $**, une seule fois),
   **Create app**, envoie l'`AAB`, remplis la fiche (nom, description,
   captures d'écran, politique de confidentialité), soumets. Validation : ~1–3 jours.

### 🍎 App Store (iOS)

1. Dans PWABuilder → **iOS → Generate Package** → tu obtiens un **projet Xcode**.
2. Il te faut un **Mac** avec **Xcode** et un compte **Apple Developer**
   (**99 $/an**).
3. Ouvre le projet, règle l'identifiant (`app.toumai`), signe avec ton compte,
   puis **Archive → Distribute** vers **App Store Connect**.
4. Remplis la fiche (captures, description, confidentialité), soumets à la revue
   Apple. Validation : quelques jours.

---

## Alternative Android : Bubblewrap (en ligne de commande)

Pour ceux qui préfèrent le terminal (nécessite Node + le SDK Android) :

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://TON-DOMAINE/manifest.webmanifest
bubblewrap build      # génère l'AAB + affiche les empreintes SHA-256
```

Reporte ensuite les empreintes dans `ANDROID_SHA256_FINGERPRINTS` (comme ci-dessus).

---

## Check-list avant soumission

- [ ] App **en ligne en HTTPS**, testée sur mobile.
- [ ] **Politique de confidentialité** accessible (URL publique) — exigée par les deux stores.
- [ ] **Captures d'écran** (téléphone) et une icône 512×512 — déjà fournie (`public/icons/icon-512.png`).
- [ ] Android : `assetlinks.json` renvoie bien tes empreintes
      (`https://TON-DOMAINE/.well-known/assetlinks.json`).
- [ ] Nom, description, catégorie prêts (les deux fiches).

> 💡 **Conseil** : lance d'abord en **PWA** (tes clients installent depuis le
> navigateur, aujourd'hui, gratuitement). Publie sur les stores ensuite, sans
> bloquer ton démarrage. La technique est prête des deux côtés.
