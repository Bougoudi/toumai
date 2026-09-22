-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'SALE', 'RETURN', 'CANCELLATION', 'RESERVATION_RELEASE', 'ADJUSTMENT', 'IMPORT', 'PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGE', 'LOSS', 'COUNT_CORRECTION');

-- CreateTable
CREATE TABLE "touma_stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "quantityAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "actorId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_stock_movements_productId_variantId_createdAt_idx" ON "touma_stock_movements"("productId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_stock_movements_type_createdAt_idx" ON "touma_stock_movements"("type", "createdAt");

-- CreateIndex
CREATE INDEX "touma_stock_movements_referenceType_referenceId_idx" ON "touma_stock_movements"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "touma_stock_movements" ADD CONSTRAINT "touma_stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stock_movements" ADD CONSTRAINT "touma_stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "touma_product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stock_movements" ADD CONSTRAINT "touma_stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
