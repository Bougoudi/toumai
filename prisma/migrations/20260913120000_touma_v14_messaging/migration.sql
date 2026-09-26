-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CLOSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'SYSTEM', 'OFFER', 'COUNTER_OFFER', 'QUOTE', 'ORDER_UPDATE', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "MessageReportReason" AS ENUM ('SPAM', 'FRAUD', 'ABUSE', 'OFF_PLATFORM_PAYMENT', 'PROHIBITED_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RiskFlagCategory" AS ENUM ('OFF_PLATFORM_PAYMENT', 'CONTACT_EXCHANGE', 'SUSPICIOUS_LINK', 'FLOOD', 'REPEATED_CONTENT');

-- CreateEnum
CREATE TYPE "RiskFlagStatus" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConversationKind" ADD VALUE 'QUOTE';
ALTER TYPE "ConversationKind" ADD VALUE 'ORDER';

-- DropForeignKey
ALTER TABLE "touma_messages" DROP CONSTRAINT "touma_messages_authorId_fkey";

-- AlterTable
ALTER TABLE "touma_conversation_participants" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "businessProfileId" TEXT,
ADD COLUMN     "mutedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "touma_conversations" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "touma_message_attachments" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "storageKey" TEXT,
ALTER COLUMN "url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "touma_messages" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "negotiationMessageId" TEXT,
ADD COLUMN     "replyToId" TEXT,
ADD COLUMN     "type" "MessageType" NOT NULL DEFAULT 'TEXT',
ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "touma_negotiation_messages" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "proposedItems" JSONB,
ADD COLUMN     "proposedItemsTotal" DECIMAL(18,4),
ADD COLUMN     "proposedLeadTimeDays" INTEGER,
ADD COLUMN     "proposedShipping" DECIMAL(18,4);

-- CreateTable
CREATE TABLE "touma_message_reports" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "MessageReportReason" NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_risk_flags" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "category" "RiskFlagCategory" NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "status" "RiskFlagStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_user_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_saved_replies" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_message_reports_status_idx" ON "touma_message_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_message_reports_messageId_reporterId_key" ON "touma_message_reports"("messageId", "reporterId");

-- CreateIndex
CREATE INDEX "touma_risk_flags_conversationId_idx" ON "touma_risk_flags"("conversationId");

-- CreateIndex
CREATE INDEX "touma_risk_flags_status_createdAt_idx" ON "touma_risk_flags"("status", "createdAt");

-- CreateIndex
CREATE INDEX "touma_user_blocks_blockedId_idx" ON "touma_user_blocks"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_user_blocks_blockerId_blockedId_key" ON "touma_user_blocks"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "touma_saved_replies_ownerId_idx" ON "touma_saved_replies"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_notification_preferences_userId_category_key" ON "touma_notification_preferences"("userId", "category");

-- CreateIndex
CREATE INDEX "touma_conversation_participants_userId_lastReadAt_idx" ON "touma_conversation_participants"("userId", "lastReadAt");

-- CreateIndex
CREATE INDEX "touma_conversations_rfqId_idx" ON "touma_conversations"("rfqId");

-- CreateIndex
CREATE INDEX "touma_conversations_quoteId_idx" ON "touma_conversations"("quoteId");

-- CreateIndex
CREATE INDEX "touma_conversations_orderId_idx" ON "touma_conversations"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_message_attachments_storageKey_key" ON "touma_message_attachments"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "touma_messages_negotiationMessageId_key" ON "touma_messages"("negotiationMessageId");

-- CreateIndex
CREATE INDEX "touma_messages_conversationId_createdAt_idx" ON "touma_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_messages_authorId_createdAt_idx" ON "touma_messages"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_negotiation_messages_quoteId_createdAt_idx" ON "touma_negotiation_messages"("quoteId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_notifications_userId_readAt_idx" ON "touma_notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "touma_conversations" ADD CONSTRAINT "touma_conversations_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "touma_rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversations" ADD CONSTRAINT "touma_conversations_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "touma_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversations" ADD CONSTRAINT "touma_conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversation_participants" ADD CONSTRAINT "touma_conversation_participants_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "touma_business_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_messages" ADD CONSTRAINT "touma_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_messages" ADD CONSTRAINT "touma_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "touma_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_messages" ADD CONSTRAINT "touma_messages_negotiationMessageId_fkey" FOREIGN KEY ("negotiationMessageId") REFERENCES "touma_negotiation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_message_reports" ADD CONSTRAINT "touma_message_reports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_message_reports" ADD CONSTRAINT "touma_message_reports_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "touma_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_message_reports" ADD CONSTRAINT "touma_message_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_risk_flags" ADD CONSTRAINT "touma_risk_flags_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_risk_flags" ADD CONSTRAINT "touma_risk_flags_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "touma_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_user_blocks" ADD CONSTRAINT "touma_user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_user_blocks" ADD CONSTRAINT "touma_user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_saved_replies" ADD CONSTRAINT "touma_saved_replies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_notification_preferences" ADD CONSTRAINT "touma_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

