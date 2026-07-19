# syntax=docker/dockerfile:1

# ── Étape 1 : build (compilation TypeScript + client Prisma) ──────────────
FROM node:20-slim AS build
WORKDIR /app

# OpenSSL requis par les moteurs Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Base de production : PostgreSQL (le dépôt utilise SQLite pour le dev local).
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

RUN npx prisma generate
RUN npm run build

# ── Étape 2 : image d'exécution ──────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# On garde node_modules complet (le CLI Prisma sert au démarrage pour
# synchroniser le schéma de la base).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Fichiers statiques de la PWA, servis par Express.
COPY --from=build /app/public ./dist/public

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
