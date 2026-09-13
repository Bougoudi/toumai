# Mettre TOUMA en ligne

Ce guide part du dépôt et s'arrête quand un acheteur de N'Djamena peut ouvrir
une adresse, créer un compte et passer commande chez un vendeur de Douala.

Trois chemins, du plus simple au plus maîtrisé. Ils mènent tous au même endroit ;
choisissez selon ce que vous savez déjà administrer.

| Chemin | Pour qui | Ce que vous gérez | Coût indicatif |
| --- | --- | --- | --- |
| **Render** (blueprint fourni) | Aller vite, sans serveur à administrer | Rien, sauf les variables | ~7 $/mois + base |
| **Docker Compose sur un VPS** | Garder la main, héberger en Afrique ou en Europe | Le serveur, les sauvegardes, le HTTPS | ~5–20 $/mois |
| **Node sans conteneur** | Environnement déjà en place | Tout | Variable |

---

## Avant de choisir : trois pièges qui coûtent cher

**1. Les fichiers envoyés ne survivent pas à un redéploiement.** Les pièces
jointes de la messagerie — factures, photos de lots, listes de prix — sont
écrites sur disque. Sur la plupart des hébergements, le disque d'un conteneur est
effacé à chaque mise à jour. Il faut donc **un disque persistant** (le blueprint
Render en monte un) **ou** un stockage compatible S3 (`S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`). L'un ou l'autre, pas les deux.

**2. Les secrets par défaut empêchent le démarrage — c'est voulu.** En
production, TOUMA refuse de démarrer si `JWT_SECRET` ou `ENCRYPTION_KEY` sont
absents, trop courts ou restés sur la valeur de développement. Générez-les :

```bash
openssl rand -hex 32   # une fois par secret, jamais réutilisé entre deux rôles
```

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` et `TOUMA_PAYMENT_WEBHOOK_SECRET`
méritent chacun leur propre valeur : un secret qui sert à deux choses transforme
une fuite mineure en fuite majeure.

**3. La sonde de santé n'est pas `/health`.** `/health` dit « le processus est
debout ». `/ready` dit « la base me répond, voici les adaptateurs actifs ».
C'est `/ready` qui doit décider d'un déploiement, sinon vous mettez en ligne un
service qui affiche une erreur à chaque page.

---

## Chemin 1 — Render (le plus court)

Le dépôt contient `render.yaml`. Render le lit et crée tout.

1. <https://dashboard.render.com> → **New** → **Blueprint** → connecter ce dépôt.
2. Render crée la base PostgreSQL, le service web, le disque persistant, et
   génère les cinq secrets.
3. Renseigner les valeurs qu'il demande :
   - `PUBLIC_URL` — l'adresse finale (ex. `https://touma.onrender.com`, puis
     votre domaine). Les URL des reçus et le référencement en dépendent.
   - `ADMIN_EMAIL` et `ADMIN_PASSWORD` (≥ 10 caractères) — le compte
     administrateur créé **au premier démarrage, et seulement si la base est
     vide**. TOUMA ne réinitialise jamais un compte existant.
   - L'identité légale (`TOUMA_COMPANY_*`), si vous l'avez. Sans elle, les reçus
     l'écrivent noir sur blanc plutôt que d'inventer une raison sociale.
4. Attendre le premier déploiement. Les migrations sont appliquées au démarrage
   par `docker-entrypoint.sh` ; vous n'avez rien à lancer.

Ajouter votre domaine ensuite : **Settings → Custom Domain**. Render s'occupe du
certificat. Pensez à remettre `PUBLIC_URL` à jour.

---

## Chemin 2 — Docker Compose sur un VPS

Un serveur à 2 Go de mémoire suffit pour démarrer.

```bash
git clone <votre-dépôt> touma && cd touma
cp .env.example .env
```

Dans `.env`, au minimum :

```bash
JWT_SECRET=…                      # openssl rand -hex 32
JWT_ACCESS_SECRET=…
JWT_REFRESH_SECRET=…
ENCRYPTION_KEY=…
TOUMA_PAYMENT_WEBHOOK_SECRET=…
POSTGRES_PASSWORD=…               # pas « touma »
PUBLIC_URL=https://touma.example
ADMIN_EMAIL=vous@example.com
ADMIN_PASSWORD=…
TOUMA_DEFAULT_CURRENCY=XAF
```

Puis :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f api        # les migrations passent au démarrage
```

La surcouche `docker-compose.prod.yml` fait trois choses qui comptent : elle
**cesse de publier les ports de PostgreSQL et de Redis** sur l'hôte (en
développement c'est commode, sur Internet c'est une base de données offerte au
premier balayage venu), elle place les pièces jointes sur un **volume nommé**, et
elle **borne les journaux** — un serveur qui remplit son disque de logs s'arrête
aussi sûrement qu'un serveur en panne.

**HTTPS.** TOUMA écoute en HTTP sur 3000 ; le certificat se règle devant, avec
Caddy (deux lignes) ou Nginx + certbot :

```caddy
touma.example {
    reverse_proxy 127.0.0.1:3000
}
```

L'application sait qu'elle est derrière un proxy (`trust proxy`) : la limitation
de débit compte bien les vraies adresses, pas celle du proxy.

**Sauvegardes.** Une base sans sauvegarde testée n'est pas une base de
production :

```bash
docker compose exec -T postgres pg_dump -U touma touma | gzip > touma-$(date +%F).sql.gz
```

Mettez-la dans une tâche planifiée, copiez-la **ailleurs que sur le serveur**, et
restaurez-en une une fois : une sauvegarde jamais restaurée est une hypothèse.

---

## Chemin 3 — Node sans conteneur

```bash
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
NODE_ENV=production node dist/src/index.js
```

C'est exactement ce que fait l'image Docker. Le serveur sert les fichiers
statiques depuis `dist/public` : si vous compilez à la main, copiez `public/`
dans `dist/public` (le `Dockerfile` le fait pour vous).

Placez le processus sous `systemd` ou `pm2` pour qu'il redémarre seul.

---

## Après la mise en ligne : vérifier en cinq minutes

```bash
curl -s https://touma.example/ready | jq        # ready: true, postgres: ok
curl -s -o /dev/null -w '%{http_code}\n' https://touma.example/touma/
curl -s https://touma.example/api/v1/countries  # Tchad et Cameroun, actifs
```

Puis, dans un navigateur : créer un compte, ajouter un produit au panier, aller
jusqu'à l'écran de paiement. Tant qu'aucun prestataire réel n'est raccordé,
l'adaptateur de démonstration confirme le paiement — c'est normal, et c'est écrit
dans l'interface.

Enfin, connectez-vous avec le compte administrateur et regardez
`/touma/admin/moderation` : si la page s'affiche, l'authentification, les rôles
et la base fonctionnent ensemble.

---

## Ce qui reste à décider (et que le code attend)

Ces éléments ne sont pas des oublis : chacun demande un compte ou une décision
d'exploitation. Les interfaces sont en place et documentées.

| Décision | Variable(s) | Sans elle |
| --- | --- | --- |
| Prestataire de paiement (Mobile Money, carte) | `TOUMA_PAYMENT_PROVIDER` | Adaptateur de démonstration |
| Transporteur | `TOUMA_LOGISTICS_PROVIDER` | Tarifs et suivi simulés |
| Envoi d'e-mails | `RESEND_API_KEY`, `EMAIL_FROM` | Notifications dans l'application uniquement |
| Stockage objet | `S3_*` | Disque local (prévoir un disque persistant) |
| Régime de TVA | — | Les documents indiquent qu'aucune TVA n'est calculée |

Détail complet : `TOUMA-V14-MESSAGING.md` (messagerie et pièces jointes),
`docs/touma-marketplace.md` (architecture et décisions).
