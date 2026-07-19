#!/bin/sh
set -e

echo "→ Synchronisation du schéma de la base de données (PostgreSQL)..."
npx prisma db push --skip-generate

echo "→ Démarrage de Toumai..."
exec node dist/src/index.js
