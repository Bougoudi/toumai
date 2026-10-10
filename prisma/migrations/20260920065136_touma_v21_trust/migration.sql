/*
  Warnings:

  - The `status` column on the `touma_reviews` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "VerificationLevel" AS ENUM ('NONE', 'BASIC', 'BUSINESS', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "TrustEntityType" AS ENUM ('SELLER', 'BUYER', 'SUPPLIER', 'PRODUCT');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('INSUFFICIENT_DATA', 'LOW', 'MODERATE', 'GOOD', 'EXCELLENT');

-- CreateEnum
CREATE TYPE "AccountStandingStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "TrustAppealStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewModerationStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ReviewRiskAction" AS ENUM ('ALLOW', 'FLAG', 'HOLD', 'REVIEW');

-- CreateEnum
CREATE TYPE "TransactionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TransactionRiskDecision" AS ENUM ('ALLOW', 'REVIEW', 'REQUIRE_VERIFICATION', 'HOLD', 'BLOCK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "VerificationStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "VerificationStatus" ADD VALUE 'EXPIRED';

-- AlterTable
--
-- Prisma proposait DROP COLUMN "status" puis ADD COLUMN : tous les avis déjà
-- modérés seraient repassés à PUBLISHED, y compris ceux qu'un administrateur
-- avait rejetés. Les valeurs existantes ('PENDING', 'PUBLISHED', 'REJECTED')
-- sont toutes des membres du nouvel enum : une conversion en place les garde.
ALTER TABLE "touma_reviews" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedById" TEXT,
ADD COLUMN     "moderationReason" TEXT;

ALTER TABLE "touma_reviews" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "touma_reviews"
  ALTER COLUMN "status" TYPE "ReviewModerationStatus"
  USING "status"::"ReviewModerationStatus";
ALTER TABLE "touma_reviews" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "touma_seller_verifications" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "grantedLevel" "VerificationLevel" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "requestedLevel" "VerificationLevel" NOT NULL DEFAULT 'BASIC';

-- AlterTable
ALTER TABLE "touma_stores" ADD COLUMN     "verificationLevel" "VerificationLevel" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "touma_trust_scores" (
    "id" TEXT NOT NULL,
    "entityType" "TrustEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "score" INTEGER,
    "level" "TrustLevel" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trust_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trust_score_snapshots" (
    "id" TEXT NOT NULL,
    "entityType" "TrustEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "score" INTEGER,
    "level" "TrustLevel" NOT NULL,
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL,
    "delta" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_trust_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trust_badges" (
    "id" TEXT NOT NULL,
    "entityType" "TrustEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "touma_trust_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trust_events" (
    "id" TEXT NOT NULL,
    "entityType" "TrustEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "touma_trust_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_account_standings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountStandingStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "publicReason" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "actorId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_account_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trust_appeals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "status" "TrustAppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "message" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "reviewerId" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trust_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_review_risk_scores" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "action" "ReviewRiskAction" NOT NULL DEFAULT 'ALLOW',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_review_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_transaction_risks" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "TransactionRiskLevel" NOT NULL,
    "decision" "TransactionRiskDecision" NOT NULL DEFAULT 'ALLOW',
    "factors" JSONB NOT NULL DEFAULT '[]',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_transaction_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_supplier_scores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rfqsInvited" INTEGER NOT NULL DEFAULT 0,
    "quotesSubmitted" INTEGER NOT NULL DEFAULT 0,
    "quotesAccepted" INTEGER NOT NULL DEFAULT 0,
    "b2bOrders" INTEGER NOT NULL DEFAULT 0,
    "responseRate" DECIMAL(5,4),
    "acceptanceRate" DECIMAL(5,4),
    "medianQuoteHours" DECIMAL(10,2),
    "score" INTEGER,
    "level" "TrustLevel" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_supplier_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_trust_scores_entityType_score_idx" ON "touma_trust_scores"("entityType", "score");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trust_scores_entityType_entityId_key" ON "touma_trust_scores"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "touma_trust_score_snapshots_entityType_entityId_createdAt_idx" ON "touma_trust_score_snapshots"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_trust_badges_entityType_entityId_revokedAt_idx" ON "touma_trust_badges"("entityType", "entityId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trust_badges_entityType_entityId_code_key" ON "touma_trust_badges"("entityType", "entityId", "code");

-- CreateIndex
CREATE INDEX "touma_trust_events_entityType_entityId_occurredAt_idx" ON "touma_trust_events"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "touma_trust_events_processedAt_idx" ON "touma_trust_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_account_standings_userId_key" ON "touma_account_standings"("userId");

-- CreateIndex
CREATE INDEX "touma_account_standings_status_idx" ON "touma_account_standings"("status");

-- CreateIndex
CREATE INDEX "touma_trust_appeals_userId_idx" ON "touma_trust_appeals"("userId");

-- CreateIndex
CREATE INDEX "touma_trust_appeals_status_createdAt_idx" ON "touma_trust_appeals"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_review_risk_scores_reviewId_key" ON "touma_review_risk_scores"("reviewId");

-- CreateIndex
CREATE INDEX "touma_review_risk_scores_action_idx" ON "touma_review_risk_scores"("action");

-- CreateIndex
CREATE UNIQUE INDEX "touma_transaction_risks_orderId_key" ON "touma_transaction_risks"("orderId");

-- CreateIndex
CREATE INDEX "touma_transaction_risks_level_createdAt_idx" ON "touma_transaction_risks"("level", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_supplier_scores_userId_key" ON "touma_supplier_scores"("userId");

-- CreateIndex
CREATE INDEX "touma_supplier_scores_score_idx" ON "touma_supplier_scores"("score");

-- CreateIndex
CREATE INDEX "touma_reviews_status_idx" ON "touma_reviews"("status");

-- AddForeignKey
ALTER TABLE "touma_account_standings" ADD CONSTRAINT "touma_account_standings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_account_standings" ADD CONSTRAINT "touma_account_standings_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trust_appeals" ADD CONSTRAINT "touma_trust_appeals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trust_appeals" ADD CONSTRAINT "touma_trust_appeals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_review_risk_scores" ADD CONSTRAINT "touma_review_risk_scores_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "touma_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_transaction_risks" ADD CONSTRAINT "touma_transaction_risks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_supplier_scores" ADD CONSTRAINT "touma_supplier_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
