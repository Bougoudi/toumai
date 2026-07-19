# Guide : activer et tester la double authentification (2FA)

Ce guide vous fait activer le 2FA et le tester de bout en bout.

## 1. Lancer l'application

```bash
npm install
cp .env.example .env
npm run prisma:generate && npm run db:push && npm run db:seed
npm start
```

Ouvrez **http://localhost:3000** et connectez-vous :

```
admin@toumai.local  /  toumai1234
```

> En tant qu'administrateur, une fenêtre vous demandera d'activer le 2FA
> (obligatoire pour les admins). Cliquez **« Activer maintenant »**.

## 2. Activer l'application d'authentification (TOTP)

1. **Paramètres → Sécurité du compte → Activer** (ligne « Application d'authentification »).
2. Sur votre téléphone, installez une app d'authentification :
   **Google Authenticator**, **Authy**, **Microsoft Authenticator** ou **1Password**.
3. Dans l'app, choisissez « Scanner un QR code » et scannez le QR affiché à l'écran.
4. Entrez le code à 6 chiffres affiché par l'app, puis **Activer**.
5. **Notez vos 10 codes de récupération** (affichés une seule fois) et gardez-les
   en lieu sûr (gestionnaire de mots de passe, papier dans un tiroir).

## 3. Tester la connexion en deux étapes

1. **Déconnexion**, puis reconnectez-vous avec email + mot de passe.
2. L'écran **« Vérification en deux étapes »** apparaît.
3. Entrez le code affiché par votre app d'authentification → vous êtes connecté.

## 4. (Optionnel) Ajouter une clé de sécurité / passkey

1. **Paramètres → Sécurité → Clés de sécurité → ＋ Ajouter**.
2. Suivez l'invite du navigateur (clé USB **YubiKey**, **Touch ID**, **Windows Hello**,
   ou passkey du téléphone).
3. À la prochaine connexion, cliquez **« 🔑 Utiliser une clé de sécurité »**.

> WebAuthn nécessite **HTTPS** en production (fonctionne sur `localhost` en dev).

## 5. En cas de perte du téléphone

Sur l'écran de connexion en deux étapes, cliquez **« Utiliser un code de
récupération »** et entrez l'un de vos codes (chacun ne marche qu'une fois).

## 6. Sécurité supplémentaire (onglet Paramètres → Sécurité)

- **Se déconnecter de partout** — invalide toutes les sessions (appareil perdu/volé).
- **Régénérer les codes de récupération** — si vous les avez épuisés/perdus.
- **Journal de connexions** — vérifiez les accès récents et repérez un
  « Nouvel appareil » inattendu.

Les actions sensibles (désactiver le 2FA, retirer une clé, supprimer le compte)
demandent une **confirmation d'identité** (mot de passe ou code) avant de s'exécuter.
