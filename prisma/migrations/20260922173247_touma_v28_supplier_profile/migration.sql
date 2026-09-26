-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR', 'RETAILER', 'TRADER', 'SERVICE_PROVIDER');

-- CreateTable
CREATE TABLE "touma_supplier_profiles" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "types" "SupplierType"[] DEFAULT ARRAY[]::"SupplierType"[],
    "declaredCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "declaredCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "declaredLeadTimeDays" INTEGER,
    "declaredMinOrderValue" DECIMAL(18,4),
    "declaredMinOrderQty" INTEGER,
    "paymentTerms" TEXT,
    "shippingNotes" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_supplier_profiles_storeId_key" ON "touma_supplier_profiles"("storeId");

-- CreateIndex
CREATE INDEX "touma_supplier_profiles_storeId_idx" ON "touma_supplier_profiles"("storeId");

-- AddForeignKey
ALTER TABLE "touma_supplier_profiles" ADD CONSTRAINT "touma_supplier_profiles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
