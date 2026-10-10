-- CreateEnum
CREATE TYPE "CountryProviderType" AS ENUM ('PAYMENT', 'SHIPPING', 'SMS', 'EMAIL', 'FX', 'KYC', 'COMPLIANCE', 'MAPS', 'SEARCH');

-- CreateEnum
CREATE TYPE "CountryProviderStatus" AS ENUM ('PLANNED', 'CONFIGURING', 'TESTING', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "touma_country_providers" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "type" "CountryProviderType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "CountryProviderStatus" NOT NULL DEFAULT 'PLANNED',
    "simulation" BOOLEAN NOT NULL DEFAULT false,
    "supportedMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "configuration" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "healthDetail" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_country_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_country_providers_countryCode_type_status_idx" ON "touma_country_providers"("countryCode", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_country_providers_countryCode_type_code_key" ON "touma_country_providers"("countryCode", "type", "code");

-- AddForeignKey
ALTER TABLE "touma_country_providers" ADD CONSTRAINT "touma_country_providers_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;
