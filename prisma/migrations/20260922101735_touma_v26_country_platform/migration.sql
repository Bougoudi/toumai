-- CreateEnum
CREATE TYPE "CountryStatus" AS ENUM ('PLANNED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'LIMITED', 'SUSPENDED', 'DEPRECATED');

-- AlterTable
ALTER TABLE "touma_countries" ADD COLUMN     "nativeName" TEXT,
ADD COLUMN     "status" "CountryStatus" NOT NULL DEFAULT 'PLANNED';

-- CreateTable
CREATE TABLE "touma_country_status_changes" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "fromStatus" "CountryStatus" NOT NULL,
    "toStatus" "CountryStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "readiness" JSONB,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_country_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_country_division_levels" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT NOT NULL,
    "nameAr" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_country_division_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_country_status_changes_countryCode_createdAt_idx" ON "touma_country_status_changes"("countryCode", "createdAt");

-- CreateIndex
CREATE INDEX "touma_country_division_levels_countryCode_idx" ON "touma_country_division_levels"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "touma_country_division_levels_countryCode_level_key" ON "touma_country_division_levels"("countryCode", "level");

-- AddForeignKey
ALTER TABLE "touma_country_status_changes" ADD CONSTRAINT "touma_country_status_changes_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_country_status_changes" ADD CONSTRAINT "touma_country_status_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_country_division_levels" ADD CONSTRAINT "touma_country_division_levels_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise des données : le statut ne doit pas repartir de PLANNED.
--
-- La valeur par défaut du nouveau champ mettrait le Tchad à PLANNED, c'est-à-dire
-- fermerait le marché pilote au moment du déploiement. Le statut est donc déduit
-- des interrupteurs tels qu'ils étaient : c'est l'état dans lequel le système
-- fonctionnait réellement, et le reprendre ne change le comportement de personne.
--
-- Ce n'est volontairement PAS une occasion de corriger les incohérences. Que le
-- Cameroun se retrouve ACTIVE alors qu'il n'a ni géographie ni transporteur est
-- exact : c'était son état. Le contrôle de préparation le dira, et la
-- rétrogradation sera une décision tracée, pas un effet de bord de migration.
UPDATE "touma_countries"
SET "status" = CASE
  WHEN "active" AND "buyingEnabled" AND "sellingEnabled" THEN 'ACTIVE'::"CountryStatus"
  WHEN "active" THEN 'LIMITED'::"CountryStatus"
  ELSE 'PLANNED'::"CountryStatus"
END;
