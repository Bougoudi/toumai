#!/bin/sh
set -e

# Mise à niveau de la base.
#
# Cas 1 — base neuve ou déjà migrée : `prisma migrate deploy` suffit.
# Cas 2 — base créée AVANT l'introduction des migrations (via `prisma db push`,
#         comme les déploiements existants) : Prisma refuse de déployer sur un
#         schéma non vide (P3005). On synchronise alors le schéma (ce qui crée
#         les tables `touma_*` manquantes) puis on marque la migration initiale
#         comme appliquée : les migrations suivantes se dérouleront normalement.
echo "→ Application des migrations de base de données…"
if ! npx prisma migrate deploy; then
  echo "→ Base antérieure aux migrations détectée : synchronisation puis alignement…"
  npx prisma db push --skip-generate
  npx prisma migrate resolve --applied 0_init
  npx prisma migrate deploy
fi

echo "→ Démarrage de Touma…"
exec node dist/src/index.js
