-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('HOME', 'PICKUP_POINT', 'SELLER_PICKUP');

-- CreateEnum
CREATE TYPE "OrderGroupStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_FULFILLED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('OPEN', 'QUOTED', 'AWARDED', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SUBMITTED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "NegotiationKind" AS ENUM ('MESSAGE', 'COUNTER_OFFER', 'ACCEPT', 'REJECT');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('BUYER_SELLER', 'RFQ', 'SUPPORT');

-- AlterTable
ALTER TABLE "touma_addresses" ADD COLUMN     "district" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "touma_orders" ADD COLUMN     "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'HOME',
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "pickupPointId" TEXT;

-- AlterTable
ALTER TABLE "touma_payments" ADD COLUMN     "orderGroupId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "touma_order_groups" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" "OrderGroupStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "itemsTotal" DECIMAL(18,4) NOT NULL,
    "shippingTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "shippingSnapshot" JSONB NOT NULL,
    "checkoutKey" TEXT,
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "touma_order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_pickup_points" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "landmark" TEXT,
    "addressLine" TEXT NOT NULL,
    "phone" TEXT,
    "openingHours" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_pickup_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_business_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "registrationNo" TEXT,
    "taxId" TEXT,
    "sector" TEXT,
    "countryCode" TEXT NOT NULL,
    "city" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "annualVolume" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_rfqs" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "businessProfileId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL,
    "city" TEXT,
    "currency" TEXT NOT NULL,
    "sourceCountry" TEXT,
    "status" "RfqStatus" NOT NULL DEFAULT 'OPEN',
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "touma_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_rfq_items" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pièce',
    "targetUnitPrice" DECIMAL(18,4),
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_rfq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_quotes" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "itemsTotal" DECIMAL(18,4) NOT NULL,
    "shippingTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "message" TEXT,
    "orderGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "touma_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pièce',
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_negotiation_messages" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "NegotiationKind" NOT NULL DEFAULT 'MESSAGE',
    "body" TEXT NOT NULL,
    "proposedTotal" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_negotiation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_conversations" (
    "id" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL DEFAULT 'BUYER_SELLER',
    "subject" TEXT,
    "storeId" TEXT,
    "orderId" TEXT,
    "rfqId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_message_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_order_groups_reference_key" ON "touma_order_groups"("reference");

-- CreateIndex
CREATE INDEX "touma_order_groups_buyerId_idx" ON "touma_order_groups"("buyerId");

-- CreateIndex
CREATE INDEX "touma_order_groups_status_idx" ON "touma_order_groups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_order_groups_buyerId_checkoutKey_key" ON "touma_order_groups"("buyerId", "checkoutKey");

-- CreateIndex
CREATE UNIQUE INDEX "touma_pickup_points_code_key" ON "touma_pickup_points"("code");

-- CreateIndex
CREATE INDEX "touma_pickup_points_countryCode_city_idx" ON "touma_pickup_points"("countryCode", "city");

-- CreateIndex
CREATE UNIQUE INDEX "touma_business_profiles_userId_key" ON "touma_business_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_rfqs_reference_key" ON "touma_rfqs"("reference");

-- CreateIndex
CREATE INDEX "touma_rfqs_buyerId_idx" ON "touma_rfqs"("buyerId");

-- CreateIndex
CREATE INDEX "touma_rfqs_status_idx" ON "touma_rfqs"("status");

-- CreateIndex
CREATE INDEX "touma_rfqs_countryCode_idx" ON "touma_rfqs"("countryCode");

-- CreateIndex
CREATE INDEX "touma_rfq_items_rfqId_idx" ON "touma_rfq_items"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_quotes_reference_key" ON "touma_quotes"("reference");

-- CreateIndex
CREATE INDEX "touma_quotes_rfqId_idx" ON "touma_quotes"("rfqId");

-- CreateIndex
CREATE INDEX "touma_quotes_storeId_idx" ON "touma_quotes"("storeId");

-- CreateIndex
CREATE INDEX "touma_quotes_status_idx" ON "touma_quotes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_quotes_rfqId_storeId_key" ON "touma_quotes"("rfqId", "storeId");

-- CreateIndex
CREATE INDEX "touma_quote_items_quoteId_idx" ON "touma_quote_items"("quoteId");

-- CreateIndex
CREATE INDEX "touma_negotiation_messages_quoteId_idx" ON "touma_negotiation_messages"("quoteId");

-- CreateIndex
CREATE INDEX "touma_conversations_storeId_idx" ON "touma_conversations"("storeId");

-- CreateIndex
CREATE INDEX "touma_conversations_lastMessageAt_idx" ON "touma_conversations"("lastMessageAt");

-- CreateIndex
CREATE INDEX "touma_conversation_participants_userId_idx" ON "touma_conversation_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_conversation_participants_conversationId_userId_key" ON "touma_conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "touma_messages_conversationId_idx" ON "touma_messages"("conversationId");

-- CreateIndex
CREATE INDEX "touma_message_attachments_messageId_idx" ON "touma_message_attachments"("messageId");

-- CreateIndex
CREATE INDEX "touma_orders_groupId_idx" ON "touma_orders"("groupId");

-- CreateIndex
CREATE INDEX "touma_payments_orderGroupId_idx" ON "touma_payments"("orderGroupId");

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "touma_order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "touma_pickup_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_payments" ADD CONSTRAINT "touma_payments_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "touma_order_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_order_groups" ADD CONSTRAINT "touma_order_groups_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_business_profiles" ADD CONSTRAINT "touma_business_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfqs" ADD CONSTRAINT "touma_rfqs_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfqs" ADD CONSTRAINT "touma_rfqs_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "touma_business_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfq_items" ADD CONSTRAINT "touma_rfq_items_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "touma_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfq_items" ADD CONSTRAINT "touma_rfq_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "touma_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quotes" ADD CONSTRAINT "touma_quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "touma_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quotes" ADD CONSTRAINT "touma_quotes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quotes" ADD CONSTRAINT "touma_quotes_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quotes" ADD CONSTRAINT "touma_quotes_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "touma_order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quote_items" ADD CONSTRAINT "touma_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "touma_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_quote_items" ADD CONSTRAINT "touma_quote_items_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "touma_rfq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_negotiation_messages" ADD CONSTRAINT "touma_negotiation_messages_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "touma_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_negotiation_messages" ADD CONSTRAINT "touma_negotiation_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversations" ADD CONSTRAINT "touma_conversations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversations" ADD CONSTRAINT "touma_conversations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversation_participants" ADD CONSTRAINT "touma_conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_conversation_participants" ADD CONSTRAINT "touma_conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_messages" ADD CONSTRAINT "touma_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_messages" ADD CONSTRAINT "touma_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_message_attachments" ADD CONSTRAINT "touma_message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "touma_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

