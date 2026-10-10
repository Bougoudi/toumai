-- CreateTable
CREATE TABLE "touma_store_service_zones" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "provinceId" TEXT,
    "departmentId" TEXT,
    "served" BOOLEAN NOT NULL DEFAULT true,
    "handlingDays" INTEGER,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_store_service_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_store_service_zones_storeId_active_idx" ON "touma_store_service_zones"("storeId", "active");

-- CreateIndex
CREATE INDEX "touma_store_service_zones_provinceId_idx" ON "touma_store_service_zones"("provinceId");

-- AddForeignKey
ALTER TABLE "touma_store_service_zones" ADD CONSTRAINT "touma_store_service_zones_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_store_service_zones" ADD CONSTRAINT "touma_store_service_zones_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_store_service_zones" ADD CONSTRAINT "touma_store_service_zones_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

