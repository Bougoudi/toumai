-- TOUMA V20 — règlement des vendeurs
--
-- `ToumaSellerPayout` existait depuis plusieurs versions et n'était lu ni écrit
-- nulle part : un vendeur n'avait aucun moyen de savoir ce qui lui revenait.
-- Cette migration lui donne son cycle de vie (ELIGIBLE, ON_HOLD, CANCELLED) et
-- ajoute la part de règlement, qui dit enfin quelle boutique attend quoi sur
-- quel paiement.
--
-- Purement additive : aucune donnée existante n'est touchée. La table des
-- versements est vide — aucun n'a jamais été créé — donc la contrainte
-- d'unicité sur la référence ne peut heurter aucune ligne.

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'SETTLED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutStatus" ADD VALUE 'ELIGIBLE';
ALTER TYPE "PayoutStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "PayoutStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "touma_seller_payouts" ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "providerRef" TEXT;

-- CreateTable
CREATE TABLE "touma_settlement_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "commissionAmount" DECIMAL(18,4) NOT NULL,
    "shippingAmount" DECIMAL(18,4) NOT NULL,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_settlement_allocations_orderId_key" ON "touma_settlement_allocations"("orderId");

-- CreateIndex
CREATE INDEX "touma_settlement_allocations_storeId_status_idx" ON "touma_settlement_allocations"("storeId", "status");

-- CreateIndex
CREATE INDEX "touma_settlement_allocations_paymentId_idx" ON "touma_settlement_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "touma_settlement_allocations_payoutId_idx" ON "touma_settlement_allocations"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_seller_payouts_reference_key" ON "touma_seller_payouts"("reference");

-- AddForeignKey
ALTER TABLE "touma_settlement_allocations" ADD CONSTRAINT "touma_settlement_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "touma_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_settlement_allocations" ADD CONSTRAINT "touma_settlement_allocations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_settlement_allocations" ADD CONSTRAINT "touma_settlement_allocations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_settlement_allocations" ADD CONSTRAINT "touma_settlement_allocations_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "touma_seller_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_seller_payouts" ADD CONSTRAINT "touma_seller_payouts_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

