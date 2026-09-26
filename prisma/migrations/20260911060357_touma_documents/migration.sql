-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIPT', 'PURCHASE_ORDER', 'DELIVERY_NOTE');

-- CreateEnum
CREATE TYPE "DocumentIssuer" AS ENUM ('STORE', 'PLATFORM', 'BUYER');

-- CreateTable
CREATE TABLE "touma_documents" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "issuerKind" "DocumentIssuer" NOT NULL,
    "storeId" TEXT,
    "buyerId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderGroupId" TEXT,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "sourceKey" TEXT,
    "relatedDocumentId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_document_sequences" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_documents_number_key" ON "touma_documents"("number");

-- CreateIndex
CREATE UNIQUE INDEX "touma_documents_sourceKey_key" ON "touma_documents"("sourceKey");

-- CreateIndex
CREATE INDEX "touma_documents_buyerId_idx" ON "touma_documents"("buyerId");

-- CreateIndex
CREATE INDEX "touma_documents_storeId_idx" ON "touma_documents"("storeId");

-- CreateIndex
CREATE INDEX "touma_documents_orderId_idx" ON "touma_documents"("orderId");

-- CreateIndex
CREATE INDEX "touma_documents_type_idx" ON "touma_documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "touma_document_sequences_key_key" ON "touma_document_sequences"("key");

-- AddForeignKey
ALTER TABLE "touma_documents" ADD CONSTRAINT "touma_documents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_documents" ADD CONSTRAINT "touma_documents_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_documents" ADD CONSTRAINT "touma_documents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_documents" ADD CONSTRAINT "touma_documents_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "touma_order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
