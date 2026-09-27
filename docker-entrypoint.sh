#!/bin/sh
set -e

# Mise à niveau de la base au démarrage.
#
# Cas 1 — base neuve ou déjà migrée : `prisma migrate deploy` suffit, et c'est
#         le cas normal.
# Cas 2 — base créée AVANT l'introduction des migrations (via `prisma db push`,
#         comme les premiers déploiements) : Prisma refuse de déployer sur un
#         schéma non vide, avec le code **P3005**. On synchronise alors le
#         schéma puis on marque la migration initiale comme appliquée.
#
# Ce repli était déclenché par **n'importe quel** échec de `migrate deploy`.
# Une base momentanément injoignable, un verrou de migration, une migration
# réellement fautive : tous menaient à `prisma db push`, c'est-à-dire à aligner
# la base sur le schéma du code sans qu'aucune migration ne soit relue. C'est
# exactement ce qu'un déploiement de production ne doit pas faire tout seul
# (V25 §31). Le repli est désormais réservé au seul cas qui le justifie, et
# doit en outre être autorisé explicitement.
echo "→ Application des migrations de base de données…"

if npx prisma migrate deploy 2>/tmp/migrate.err; then
  echo "→ Migrations appliquées."
else
  cat /tmp/migrate.err >&2

  if ! grep -q "P3005" /tmp/migrate.err; then
    echo "✗ Échec des migrations pour une raison autre que P3005 : arrêt." >&2
    echo "  Aucune synchronisation automatique du schéma n'est tentée — elle masquerait la cause." >&2
    exit 1
  fi

  if [ "${TOUMA_ALLOW_BASELINE:-false}" != "true" ]; then
    echo "✗ Base antérieure aux migrations détectée (P3005)." >&2
    echo "  Relancer avec TOUMA_ALLOW_BASELINE=true après avoir pris une sauvegarde vérifiée." >&2
    echo "  Voir docs/operations/runbook.md." >&2
    exit 1
  fi

  echo "→ P3005 et TOUMA_ALLOW_BASELINE=true : alignement de la base existante…"
  npx prisma db push --skip-generate
  npx prisma migrate resolve --applied 0_init
  npx prisma migrate deploy
fi

echo "→ Démarrage de Touma…"
exec node dist/src/index.js
