-- CreateEnum
CREATE TYPE "OrderSourceType" AS ENUM ('CART', 'RFQ', 'DIRECT', 'REORDER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderGroupStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "OrderGroupStatus" ADD VALUE 'PARTIALLY_SHIPPED';
ALTER TYPE "OrderGroupStatus" ADD VALUE 'SHIPPED';
ALTER TYPE "OrderGroupStatus" ADD VALUE 'PARTIALLY_DELIVERED';
ALTER TYPE "OrderGroupStatus" ADD VALUE 'DELIVERED';

-- AlterEnum
ALTER TYPE "ToumaOrderStatus" ADD VALUE 'READY_TO_SHIP';

-- AlterTable
ALTER TABLE "touma_order_groups" ADD COLUMN     "rfqId" TEXT,
ADD COLUMN     "sourceType" "OrderSourceType" NOT NULL DEFAULT 'CART';

-- AlterTable
ALTER TABLE "touma_order_items" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "touma_price_tiers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "minQuantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_price_tiers_productId_idx" ON "touma_price_tiers"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_price_tiers_productId_variantId_minQuantity_key" ON "touma_price_tiers"("productId", "variantId", "minQuantity");

-- AddForeignKey
ALTER TABLE "touma_price_tiers" ADD CONSTRAINT "touma_price_tiers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_price_tiers" ADD CONSTRAINT "touma_price_tiers_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "touma_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_order_groups" ADD CONSTRAINT "touma_order_groups_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "touma_rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

