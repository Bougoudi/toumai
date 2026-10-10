-- CreateEnum
CREATE TYPE "WebhookOutcome" AS ENUM ('ACCEPTED', 'DUPLICATE', 'INVALID_SIGNATURE', 'STALE', 'MALFORMED', 'UNKNOWN_PROVIDER', 'UNKNOWN_PAYMENT', 'ERROR');

-- CreateTable
CREATE TABLE "touma_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "outcome" "WebhookOutcome" NOT NULL,
    "reason" TEXT,
    "eventId" TEXT,
    "eventType" TEXT,
    "providerRef" TEXT,
    "paymentId" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "signatureAgeSeconds" INTEGER,
    "bodySha256" TEXT NOT NULL,
    "bodyBytes" INTEGER NOT NULL,
    "bodyExcerpt" TEXT,
    "sourceIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_webhook_deliveries_provider_createdAt_idx" ON "touma_webhook_deliveries"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "touma_webhook_deliveries_outcome_createdAt_idx" ON "touma_webhook_deliveries"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "touma_webhook_deliveries_bodySha256_idx" ON "touma_webhook_deliveries"("bodySha256");

-- CreateIndex
CREATE INDEX "touma_webhook_deliveries_paymentId_idx" ON "touma_webhook_deliveries"("paymentId");

-- AddForeignKey
ALTER TABLE "touma_webhook_deliveries" ADD CONSTRAINT "touma_webhook_deliveries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "touma_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

