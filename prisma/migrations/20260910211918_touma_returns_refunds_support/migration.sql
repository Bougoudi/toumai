-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DAMAGED', 'NOT_AS_DESCRIBED', 'WRONG_ITEM', 'MISSING_PARTS', 'NOT_DELIVERED', 'CHANGED_MIND', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ORDER', 'PAYMENT', 'DELIVERY', 'RETURN', 'ACCOUNT', 'STORE', 'VERIFICATION', 'OTHER');

-- CreateTable
CREATE TABLE "touma_return_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "requestedAmount" DECIMAL(18,4) NOT NULL,
    "approvedAmount" DECIMAL(18,4),
    "refundShipping" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "sellerNote" TEXT,
    "rejectionNote" TEXT,
    "trackingNumber" TEXT,
    "decidedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_return_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "condition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_refunds" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "returnRequestId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "touma_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_support_tickets" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "storeId" TEXT,
    "assignedToId" TEXT,
    "lastReplyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_return_requests_reference_key" ON "touma_return_requests"("reference");

-- CreateIndex
CREATE INDEX "touma_return_requests_orderId_idx" ON "touma_return_requests"("orderId");

-- CreateIndex
CREATE INDEX "touma_return_requests_buyerId_idx" ON "touma_return_requests"("buyerId");

-- CreateIndex
CREATE INDEX "touma_return_requests_storeId_idx" ON "touma_return_requests"("storeId");

-- CreateIndex
CREATE INDEX "touma_return_requests_status_idx" ON "touma_return_requests"("status");

-- CreateIndex
CREATE INDEX "touma_return_items_orderItemId_idx" ON "touma_return_items"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_return_items_returnRequestId_orderItemId_key" ON "touma_return_items"("returnRequestId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_refunds_reference_key" ON "touma_refunds"("reference");

-- CreateIndex
CREATE INDEX "touma_refunds_orderId_idx" ON "touma_refunds"("orderId");

-- CreateIndex
CREATE INDEX "touma_refunds_paymentId_idx" ON "touma_refunds"("paymentId");

-- CreateIndex
CREATE INDEX "touma_refunds_returnRequestId_idx" ON "touma_refunds"("returnRequestId");

-- CreateIndex
CREATE INDEX "touma_refunds_status_idx" ON "touma_refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_support_tickets_reference_key" ON "touma_support_tickets"("reference");

-- CreateIndex
CREATE INDEX "touma_support_tickets_requesterId_idx" ON "touma_support_tickets"("requesterId");

-- CreateIndex
CREATE INDEX "touma_support_tickets_status_idx" ON "touma_support_tickets"("status");

-- CreateIndex
CREATE INDEX "touma_support_tickets_assignedToId_idx" ON "touma_support_tickets"("assignedToId");

-- CreateIndex
CREATE INDEX "touma_support_messages_ticketId_idx" ON "touma_support_messages"("ticketId");

-- AddForeignKey
ALTER TABLE "touma_return_requests" ADD CONSTRAINT "touma_return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_return_requests" ADD CONSTRAINT "touma_return_requests_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_return_requests" ADD CONSTRAINT "touma_return_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_return_items" ADD CONSTRAINT "touma_return_items_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "touma_return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_return_items" ADD CONSTRAINT "touma_return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "touma_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_refunds" ADD CONSTRAINT "touma_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_refunds" ADD CONSTRAINT "touma_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "touma_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_refunds" ADD CONSTRAINT "touma_refunds_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "touma_return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_refunds" ADD CONSTRAINT "touma_refunds_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_tickets" ADD CONSTRAINT "touma_support_tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_tickets" ADD CONSTRAINT "touma_support_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_tickets" ADD CONSTRAINT "touma_support_tickets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_tickets" ADD CONSTRAINT "touma_support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_messages" ADD CONSTRAINT "touma_support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "touma_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_support_messages" ADD CONSTRAINT "touma_support_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
