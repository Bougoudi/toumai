-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING', 'TIERED_DISCOUNT', 'BUNDLE_DISCOUNT', 'FIRST_ORDER');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionFunding" AS ENUM ('PLATFORM', 'SELLER', 'PARTNER');

-- CreateEnum
CREATE TYPE "PromotionStacking" AS ENUM ('STACKABLE', 'NON_STACKABLE', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "PromotionRuleKind" AS ENUM ('MIN_ORDER_AMOUNT', 'MIN_QUANTITY', 'PRODUCT', 'CATEGORY', 'SELLER', 'COUNTRY', 'PROVINCE', 'FIRST_ORDER', 'NEW_CUSTOMER', 'CUSTOMER_SEGMENT', 'MIN_STOCK', 'MAX_STOCK');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "touma_promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "PromotionType" NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "storeId" TEXT,
    "funding" "PromotionFunding" NOT NULL DEFAULT 'PLATFORM',
    "stacking" "PromotionStacking" NOT NULL DEFAULT 'NON_STACKABLE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "maxDiscountAmount" DECIMAL(18,4),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_promotion_rules" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "kind" "PromotionRuleKind" NOT NULL,
    "threshold" DECIMAL(18,4),
    "values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_promotion_budgets" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "spent" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "stopWhenExhausted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_promotion_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_promotion_usages" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_promotion_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "countryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provinceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_product_price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SELLER',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_product_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_promotions_status_startsAt_endsAt_idx" ON "touma_promotions"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "touma_promotions_storeId_status_idx" ON "touma_promotions"("storeId", "status");

-- CreateIndex
CREATE INDEX "touma_promotion_rules_promotionId_idx" ON "touma_promotion_rules"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_promotion_budgets_promotionId_key" ON "touma_promotion_budgets"("promotionId");

-- CreateIndex
CREATE INDEX "touma_promotion_usages_promotionId_createdAt_idx" ON "touma_promotion_usages"("promotionId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_promotion_usages_userId_idx" ON "touma_promotion_usages"("userId");

-- CreateIndex
CREATE INDEX "touma_campaigns_status_startsAt_idx" ON "touma_campaigns"("status", "startsAt");

-- CreateIndex
CREATE INDEX "touma_product_price_history_productId_validFrom_idx" ON "touma_product_price_history"("productId", "validFrom");

-- CreateIndex
CREATE INDEX "touma_product_price_history_productId_validTo_idx" ON "touma_product_price_history"("productId", "validTo");

-- AddForeignKey
ALTER TABLE "touma_promotions" ADD CONSTRAINT "touma_promotions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotions" ADD CONSTRAINT "touma_promotions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "touma_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotions" ADD CONSTRAINT "touma_promotions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotion_rules" ADD CONSTRAINT "touma_promotion_rules_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "touma_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotion_budgets" ADD CONSTRAINT "touma_promotion_budgets_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "touma_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotion_usages" ADD CONSTRAINT "touma_promotion_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "touma_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotion_usages" ADD CONSTRAINT "touma_promotion_usages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_promotion_usages" ADD CONSTRAINT "touma_promotion_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_campaigns" ADD CONSTRAINT "touma_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_product_price_history" ADD CONSTRAINT "touma_product_price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
