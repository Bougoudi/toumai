# Sécurité — Toumai

Aucune application n'est « impiratable » à 100 %. Ce document décrit les
protections en place et les bonnes pratiques de déploiement pour réduire au
maximum la surface d'attaque.

## Protections intégrées

| Domaine | Mesure |
| ------- | ------ |
| **Authentification** | Comptes protégés par JWT (HS256) signé ; mots de passe hachés en **scrypt** (jamais stockés en clair). Toutes les routes `/api/*` exigent un jeton valide, sauf `/api/auth/*`, `/health` et le webhook Stripe. |
| **Force brute** | Limitation de débit stricte sur `/api/auth` (10 tentatives / 15 min / IP) et globale sur l'API (300 req/min/IP). |
| **En-têtes HTTP** | Helmet : CSP restrictive, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors 'none'` (anti-clickjacking), HSTS (sur HTTPS), `Referrer-Policy: no-referrer`, masquage de `X-Powered-By`. |
| **Secrets sensibles** | Identifiants des canaux (clés API / jetons OAuth) **chiffrés en base** (AES-256-GCM). Jamais renvoyés en clair par l'API (valeurs masquées). |
| **Paiement** | Aucune donnée de carte ne transite par Toumai : le paiement passe par **Stripe**. Le webhook vérifie la **signature** cryptographique. |
| **Injection SQL** | Requêtes via Prisma (paramétrées). |
| **Validation** | Toutes les entrées validées par Zod ; corps JSON limité à 1 Mo. |
| **Secrets faibles** | En production, le serveur **refuse de démarrer** si `JWT_SECRET`/`ENCRYPTION_KEY` sont absents ou trop courts. |
| **Fuite d'infos** | Messages d'erreur génériques ; login ne révèle pas l'existence d'un compte. |

## À faire côté déploiement (indispensable)

1. **HTTPS obligatoire** — servez toujours derrière TLS (reverse proxy : Caddy,
   Nginx, ou plateforme managée). Sans HTTPS, les jetons circulent en clair.
2. **Secrets forts et privés** — générez `JWT_SECRET` et `ENCRYPTION_KEY` :
   `openssl rand -base64 48`. Ne les commitez jamais (`.env` est ignoré par git).
3. **Base de données** — en production, utilisez PostgreSQL avec accès restreint
   et sauvegardes chiffrées. Ne pas exposer la base publiquement.
4. **`NODE_ENV=production`** — active les vérifications de configuration.
5. **Mises à jour** — surveillez les vulnérabilités : `npm audit` régulièrement.
6. **CORS** — renseignez `CORS_ORIGINS` seulement si un front est hébergé sur un
   autre domaine ; sinon laissez vide (même origine).
7. **Rotation des clés** — si `ENCRYPTION_KEY` change, les identifiants de canaux
   existants devront être re-saisis (les anciennes valeurs ne se déchiffrent plus).

## Améliorations possibles (non incluses)

- Double authentification (2FA / TOTP) pour les comptes admin.
- Révocation de jetons (liste noire ou jetons courts + refresh).
- Journal d'audit des actions sensibles.
- WAF / protection anti-DDoS au niveau infrastructure.

## Signaler une vulnérabilité

Contactez le mainteneur en privé plutôt que d'ouvrir une issue publique.
