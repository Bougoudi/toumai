-- CreateEnum
CREATE TYPE "DeliveryZoneStatus" AS ENUM ('SERVED', 'ON_REQUEST', 'UNSERVED');

-- CreateTable
CREATE TABLE "touma_delivery_zones" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "provinceId" TEXT,
    "departmentId" TEXT,
    "localityId" TEXT,
    "status" "DeliveryZoneStatus" NOT NULL DEFAULT 'SERVED',
    "estimatedMinDays" INTEGER NOT NULL,
    "estimatedMaxDays" INTEGER NOT NULL,
    "basePrice" DECIMAL(18,4) NOT NULL,
    "pricePerKg" DECIMAL(18,4),
    "currency" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL DEFAULT 'Standard',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_delivery_zones_providerCode_countryCode_idx" ON "touma_delivery_zones"("providerCode", "countryCode");

-- CreateIndex
CREATE INDEX "touma_delivery_zones_provinceId_idx" ON "touma_delivery_zones"("provinceId");

-- CreateIndex
CREATE INDEX "touma_delivery_zones_localityId_idx" ON "touma_delivery_zones"("localityId");

-- AddForeignKey
ALTER TABLE "touma_delivery_zones" ADD CONSTRAINT "touma_delivery_zones_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_delivery_zones" ADD CONSTRAINT "touma_delivery_zones_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_delivery_zones" ADD CONSTRAINT "touma_delivery_zones_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "touma_localities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
