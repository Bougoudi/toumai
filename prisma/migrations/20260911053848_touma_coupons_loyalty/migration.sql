-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "DiscountFunding" AS ENUM ('PLATFORM', 'STORE');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "LoyaltyEventType" AS ENUM ('EARNED', 'REDEEMED', 'REVERSED', 'ADJUSTED');

-- AlterTable
ALTER TABLE "touma_orders" ADD COLUMN     "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerFundedDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "touma_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "funding" "DiscountFunding" NOT NULL DEFAULT 'PLATFORM',
    "storeId" TEXT,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "minOrderAmount" DECIMAL(18,4),
    "maxDiscountAmount" DECIMAL(18,4),
    "countryCodes" TEXT NOT NULL DEFAULT '',
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usageLimitPerUser" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderGroupId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_loyalty_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_loyalty_events" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LoyaltyEventType" NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" TEXT,
    "orderGroupId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_loyalty_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_coupons_code_key" ON "touma_coupons"("code");

-- CreateIndex
CREATE INDEX "touma_coupons_storeId_idx" ON "touma_coupons"("storeId");

-- CreateIndex
CREATE INDEX "touma_coupons_status_idx" ON "touma_coupons"("status");

-- CreateIndex
CREATE INDEX "touma_coupon_redemptions_userId_idx" ON "touma_coupon_redemptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_coupon_redemptions_couponId_orderGroupId_key" ON "touma_coupon_redemptions"("couponId", "orderGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_loyalty_accounts_userId_key" ON "touma_loyalty_accounts"("userId");

-- CreateIndex
CREATE INDEX "touma_loyalty_events_accountId_idx" ON "touma_loyalty_events"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_loyalty_events_orderId_type_key" ON "touma_loyalty_events"("orderId", "type");

-- AddForeignKey
ALTER TABLE "touma_coupons" ADD CONSTRAINT "touma_coupons_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_coupons" ADD CONSTRAINT "touma_coupons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_coupon_redemptions" ADD CONSTRAINT "touma_coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "touma_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_coupon_redemptions" ADD CONSTRAINT "touma_coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_coupon_redemptions" ADD CONSTRAINT "touma_coupon_redemptions_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "touma_order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_loyalty_accounts" ADD CONSTRAINT "touma_loyalty_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_loyalty_events" ADD CONSTRAINT "touma_loyalty_events_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "touma_loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_loyalty_events" ADD CONSTRAINT "touma_loyalty_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_loyalty_events" ADD CONSTRAINT "touma_loyalty_events_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "touma_order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
