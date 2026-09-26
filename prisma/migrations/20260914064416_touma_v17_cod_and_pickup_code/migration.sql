-- CreateEnum
CREATE TYPE "CashCollectionStatus" AS ENUM ('COD_PENDING', 'COD_CONFIRMED', 'COD_COLLECTED', 'COD_FAILED');

-- AlterTable
ALTER TABLE "touma_orders" ADD COLUMN     "pickupCodeHash" TEXT,
ADD COLUMN     "pickupCodeSetAt" TIMESTAMP(3),
ADD COLUMN     "pickupCollectedAt" TIMESTAMP(3),
ADD COLUMN     "pickupReleasedById" TEXT;

-- CreateTable
CREATE TABLE "touma_cash_collections" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "CashCollectionStatus" NOT NULL DEFAULT 'COD_PENDING',
    "amountDue" DECIMAL(18,4) NOT NULL,
    "amountCollected" DECIMAL(18,4),
    "currency" TEXT NOT NULL,
    "collectedById" TEXT,
    "collectedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_cash_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_cod_rules" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "provinceId" TEXT,
    "storeId" TEXT,
    "categoryId" TEXT,
    "maxAmount" DECIMAL(18,4),
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_cod_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_cash_collections_paymentId_key" ON "touma_cash_collections"("paymentId");

-- CreateIndex
CREATE INDEX "touma_cash_collections_status_idx" ON "touma_cash_collections"("status");

-- CreateIndex
CREATE INDEX "touma_cod_rules_countryCode_idx" ON "touma_cod_rules"("countryCode");

-- CreateIndex
CREATE INDEX "touma_cod_rules_provinceId_idx" ON "touma_cod_rules"("provinceId");

-- CreateIndex
CREATE INDEX "touma_cod_rules_storeId_idx" ON "touma_cod_rules"("storeId");

-- AddForeignKey
ALTER TABLE "touma_cash_collections" ADD CONSTRAINT "touma_cash_collections_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "touma_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cash_collections" ADD CONSTRAINT "touma_cash_collections_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cod_rules" ADD CONSTRAINT "touma_cod_rules_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cod_rules" ADD CONSTRAINT "touma_cod_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cod_rules" ADD CONSTRAINT "touma_cod_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "touma_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_pickupReleasedById_fkey" FOREIGN KEY ("pickupReleasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
