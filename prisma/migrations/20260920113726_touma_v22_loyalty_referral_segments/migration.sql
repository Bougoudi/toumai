-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('REGISTERED', 'QUALIFIED', 'REWARDED', 'REJECTED');

-- CreateTable
CREATE TABLE "touma_loyalty_tiers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "minLifetimePoints" INTEGER,
    "minOrders" INTEGER,
    "discountPercent" DECIMAL(5,2),
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "pointsMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_referral_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'REGISTERED',
    "qualifyingOrderId" TEXT,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_customer_segments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "minOrders" INTEGER,
    "maxOrders" INTEGER,
    "minSpend" DECIMAL(18,4),
    "spendCurrency" TEXT,
    "minDaysSinceLastOrder" INTEGER,
    "maxDaysSinceLastOrder" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_customer_segment_members" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_customer_segment_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_loyalty_tiers_code_key" ON "touma_loyalty_tiers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "touma_loyalty_tiers_rank_key" ON "touma_loyalty_tiers"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "touma_referral_codes_userId_key" ON "touma_referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_referral_codes_code_key" ON "touma_referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "touma_referrals_refereeId_key" ON "touma_referrals"("refereeId");

-- CreateIndex
CREATE INDEX "touma_referrals_referrerId_status_idx" ON "touma_referrals"("referrerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_customer_segments_code_key" ON "touma_customer_segments"("code");

-- CreateIndex
CREATE INDEX "touma_customer_segment_members_userId_idx" ON "touma_customer_segment_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_customer_segment_members_segmentId_userId_key" ON "touma_customer_segment_members"("segmentId", "userId");

-- AddForeignKey
ALTER TABLE "touma_referral_codes" ADD CONSTRAINT "touma_referral_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_referrals" ADD CONSTRAINT "touma_referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_referrals" ADD CONSTRAINT "touma_referrals_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_customer_segment_members" ADD CONSTRAINT "touma_customer_segment_members_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "touma_customer_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_customer_segment_members" ADD CONSTRAINT "touma_customer_segment_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
