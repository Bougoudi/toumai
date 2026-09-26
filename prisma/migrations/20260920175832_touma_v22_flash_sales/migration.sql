-- CreateEnum
CREATE TYPE "FlashSaleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "touma_flash_sales" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FlashSaleStatus" NOT NULL DEFAULT 'DRAFT',
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "quantityLimit" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_flash_sale_claims" (
    "id" TEXT NOT NULL,
    "flashSaleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_flash_sale_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_flash_sales_status_startsAt_endsAt_idx" ON "touma_flash_sales"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "touma_flash_sales_productId_idx" ON "touma_flash_sales"("productId");

-- CreateIndex
CREATE INDEX "touma_flash_sale_claims_userId_idx" ON "touma_flash_sale_claims"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_flash_sale_claims_flashSaleId_userId_key" ON "touma_flash_sale_claims"("flashSaleId", "userId");

-- AddForeignKey
ALTER TABLE "touma_flash_sales" ADD CONSTRAINT "touma_flash_sales_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_flash_sales" ADD CONSTRAINT "touma_flash_sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_flash_sales" ADD CONSTRAINT "touma_flash_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_flash_sale_claims" ADD CONSTRAINT "touma_flash_sale_claims_flashSaleId_fkey" FOREIGN KEY ("flashSaleId") REFERENCES "touma_flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_flash_sale_claims" ADD CONSTRAINT "touma_flash_sale_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
