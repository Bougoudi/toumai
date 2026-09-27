-- TOUMA V16 — preuves vérifiables, registre comptable, litiges structurés.
--
-- ATTENTION, changement destructif assumé sur « touma_dispute_evidence ».
--
-- Les preuves existantes ne sont que des URL déclarées par un navigateur :
-- aucun fichier n'est stocké ici, rien n'a été vérifié, et il n'existe donc
-- AUCUN moyen de leur calculer une empreinte ni de garantir qu'elles n'ont pas
-- changé depuis. Les convertir en « preuves vérifiées » serait un mensonge
-- inscrit en base.
--
-- Elles sont donc supprimées, et les parties devront redéposer leurs pièces —
-- qui seront alors reçues, reconnues à leurs octets et empreintées. Sur un
-- dossier en cours, c'est une gêne ; sur une décision d'argent, c'est la seule
-- réponse honnête.
DELETE FROM "touma_dispute_evidence";

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('NON_DELIVERY', 'LATE_DELIVERY', 'DAMAGED_ITEM', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'QUALITY', 'MISSING_QUANTITY', 'PAYMENT', 'REFUND', 'FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DisputeResolutionType" AS ENUM ('BUYER_REFUND_FULL', 'BUYER_REFUND_PARTIAL', 'RETURN_AND_REFUND', 'REPLACEMENT', 'NO_REFUND', 'SELLER_FAVOR', 'BUYER_FAVOR', 'MUTUAL_AGREEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('UNOPENED', 'OPENED', 'DAMAGED', 'USED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'COMMISSION', 'REFUND', 'COMMISSION_REVERSAL', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('PHOTO', 'VIDEO', 'DOCUMENT', 'INVOICE', 'TRACKING', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DisputeStatus" ADD VALUE 'SELLER_RESPONSE_REQUIRED';
ALTER TYPE "DisputeStatus" ADD VALUE 'BUYER_RESPONSE_REQUIRED';
ALTER TYPE "DisputeStatus" ADD VALUE 'MEDIATION';
ALTER TYPE "DisputeStatus" ADD VALUE 'ESCALATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReturnReason" ADD VALUE 'QUALITY';
ALTER TYPE "ReturnReason" ADD VALUE 'SIZE';
ALTER TYPE "ReturnReason" ADD VALUE 'DOES_NOT_WORK';
ALTER TYPE "ReturnReason" ADD VALUE 'QUANTITY_SHORTAGE';
ALTER TYPE "ReturnReason" ADD VALUE 'SPECIFICATION_MISMATCH';
ALTER TYPE "ReturnReason" ADD VALUE 'DELIVERY_DAMAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReturnStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "ReturnStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "ReturnStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "touma_dispute_evidence" DROP COLUMN "url",
ADD COLUMN     "checksum" TEXT NOT NULL,
ADD COLUMN     "filename" TEXT NOT NULL,
ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "removalReason" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedById" TEXT,
ADD COLUMN     "returnRequestId" TEXT,
ADD COLUMN     "sizeBytes" INTEGER NOT NULL,
ADD COLUMN     "storageKey" TEXT NOT NULL,
ADD COLUMN     "uploadedById" TEXT NOT NULL,
ALTER COLUMN "disputeId" DROP NOT NULL,
DROP COLUMN "kind",
ADD COLUMN     "kind" "EvidenceKind" NOT NULL DEFAULT 'PHOTO';

-- AlterTable
ALTER TABLE "touma_disputes" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "buyerResponseDeadline" TIMESTAMP(3),
ADD COLUMN     "category" "DisputeCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "priority" "DisputePriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "resolutionSnapshot" JSONB,
ADD COLUMN     "resolutionType" "DisputeResolutionType",
ADD COLUMN     "sellerResponseDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "touma_return_items" ADD COLUMN     "conditionGrade" "ReturnCondition",
ADD COLUMN     "lineReason" "ReturnReason";

-- CreateTable
CREATE TABLE "touma_ledger_entries" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "heldByDisputeId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_ledger_entries_storeId_currency_idx" ON "touma_ledger_entries"("storeId", "currency");

-- CreateIndex
CREATE INDEX "touma_ledger_entries_referenceType_referenceId_idx" ON "touma_ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "touma_ledger_entries_heldByDisputeId_idx" ON "touma_ledger_entries"("heldByDisputeId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ledger_entries_referenceType_referenceId_type_key" ON "touma_ledger_entries"("referenceType", "referenceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "touma_dispute_evidence_storageKey_key" ON "touma_dispute_evidence"("storageKey");

-- CreateIndex
CREATE INDEX "touma_dispute_evidence_returnRequestId_idx" ON "touma_dispute_evidence"("returnRequestId");

-- AddForeignKey
ALTER TABLE "touma_ledger_entries" ADD CONSTRAINT "touma_ledger_entries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ledger_entries" ADD CONSTRAINT "touma_ledger_entries_heldByDisputeId_fkey" FOREIGN KEY ("heldByDisputeId") REFERENCES "touma_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_disputes" ADD CONSTRAINT "touma_disputes_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_dispute_evidence" ADD CONSTRAINT "touma_dispute_evidence_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "touma_return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_dispute_evidence" ADD CONSTRAINT "touma_dispute_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

