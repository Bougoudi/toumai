-- CreateEnum
CREATE TYPE "TradeCorridorStatus" AS ENUM ('ACTIVE', 'LIMITED', 'SUSPENDED', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "TradeEligibilityVerdict" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'REQUIRES_REVIEW', 'REQUIRES_DOCUMENT');

-- CreateEnum
CREATE TYPE "TradeDocumentKind" AS ENUM ('COMMERCIAL_INVOICE', 'PACKING_LIST', 'PROFORMA_INVOICE', 'PURCHASE_ORDER', 'CERTIFICATE_OF_ORIGIN', 'SHIPPING_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TradeDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'UPLOADED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TradeOriginStatus" AS ENUM ('UNKNOWN', 'DECLARED', 'VERIFIED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TradeCostConfidence" AS ENUM ('CONFIRMED', 'ESTIMATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TradeRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TradeExceptionKind" AS ENUM ('CUSTOMS_DELAY', 'DOCUMENT_MISSING', 'ADDRESS_ISSUE', 'CARRIER_DELAY', 'WEATHER', 'SECURITY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TradeEventKind" AS ENUM ('RFQ_CREATED', 'QUOTE_RECEIVED', 'QUOTE_ACCEPTED', 'PROFORMA_CREATED', 'ORDER_CREATED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'DOCUMENTS_READY', 'SHIPMENT_CREATED', 'IN_TRANSIT', 'CUSTOMS_REVIEW', 'OUT_FOR_DELIVERY', 'DELIVERED', 'SETTLED', 'EXCEPTION_RAISED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FxRateSource" AS ENUM ('EXTERNAL_PROVIDER', 'CENTRAL_BANK', 'MANUAL_ADMIN', 'NONE');

-- AlterTable
ALTER TABLE "touma_products" ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "manufacturerCountry" TEXT,
ADD COLUMN     "originDeclaredAt" TIMESTAMP(3),
ADD COLUMN     "originEvidence" TEXT,
ADD COLUMN     "originStatus" "TradeOriginStatus" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "touma_trade_country_configs" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "tradeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shippingProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documentKinds" "TradeDocumentKind"[] DEFAULT ARRAY[]::"TradeDocumentKind"[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_country_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_corridors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "status" "TradeCorridorStatus" NOT NULL DEFAULT 'COMING_SOON',
    "supportedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedPaymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedShippingMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredDocuments" "TradeDocumentKind"[] DEFAULT ARRAY[]::"TradeDocumentKind"[],
    "estimatedTransitMinDays" INTEGER,
    "estimatedTransitMaxDays" INTEGER,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_corridors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_rule_versions" (
    "id" TEXT NOT NULL,
    "corridorId" TEXT,
    "countryCode" TEXT,
    "ruleType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TradeRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "body" JSONB NOT NULL DEFAULT '{}',
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_cross_border_product_rules" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "allowedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedCorridors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "requiredDocuments" "TradeDocumentKind"[] DEFAULT ARRAY[]::"TradeDocumentKind"[],
    "ruleVersionId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_cross_border_product_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_orders" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "corridorId" TEXT,
    "routeId" TEXT,
    "settlementCurrency" TEXT,
    "fxSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_routes" (
    "id" TEXT NOT NULL,
    "corridorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legs" JSONB NOT NULL DEFAULT '[]',
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_eligibility_checks" (
    "id" TEXT NOT NULL,
    "corridorId" TEXT,
    "userId" TEXT,
    "buyerCountry" TEXT NOT NULL,
    "sellerCountry" TEXT NOT NULL,
    "productId" TEXT,
    "currency" TEXT,
    "paymentMethod" TEXT,
    "verdict" "TradeEligibilityVerdict" NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "requiredDocuments" "TradeDocumentKind"[] DEFAULT ARRAY[]::"TradeDocumentKind"[],
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_trade_eligibility_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_documents" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT,
    "quoteId" TEXT,
    "rfqId" TEXT,
    "kind" "TradeDocumentKind" NOT NULL,
    "status" "TradeDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "storageKey" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "issuerName" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "rejectionReason" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_trade_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_cost_estimates" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT,
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "confirmedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "estimatedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unknownComponents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fxSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_trade_cost_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_fx_rate_snapshots" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "source" "FxRateSource" NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "rateAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_fx_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_events" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT NOT NULL,
    "kind" "TradeEventKind" NOT NULL,
    "origin" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "referenceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_trade_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_trade_shipment_exceptions" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "kind" "TradeExceptionKind" NOT NULL DEFAULT 'UNKNOWN',
    "sourceName" TEXT,
    "detail" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "touma_trade_shipment_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_country_configs_countryCode_key" ON "touma_trade_country_configs"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_corridors_code_key" ON "touma_trade_corridors"("code");

-- CreateIndex
CREATE INDEX "touma_trade_corridors_status_idx" ON "touma_trade_corridors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_corridors_originCountry_destinationCountry_key" ON "touma_trade_corridors"("originCountry", "destinationCountry");

-- CreateIndex
CREATE INDEX "touma_trade_rule_versions_ruleType_status_idx" ON "touma_trade_rule_versions"("ruleType", "status");

-- CreateIndex
CREATE INDEX "touma_trade_rule_versions_effectiveFrom_idx" ON "touma_trade_rule_versions"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_rule_versions_corridorId_countryCode_ruleType_v_key" ON "touma_trade_rule_versions"("corridorId", "countryCode", "ruleType", "version");

-- CreateIndex
CREATE INDEX "touma_cross_border_product_rules_productId_idx" ON "touma_cross_border_product_rules"("productId");

-- CreateIndex
CREATE INDEX "touma_cross_border_product_rules_categoryId_idx" ON "touma_cross_border_product_rules"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_orders_orderId_key" ON "touma_trade_orders"("orderId");

-- CreateIndex
CREATE INDEX "touma_trade_orders_corridorId_idx" ON "touma_trade_orders"("corridorId");

-- CreateIndex
CREATE INDEX "touma_trade_routes_corridorId_active_idx" ON "touma_trade_routes"("corridorId", "active");

-- CreateIndex
CREATE INDEX "touma_trade_eligibility_checks_userId_createdAt_idx" ON "touma_trade_eligibility_checks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_trade_eligibility_checks_verdict_createdAt_idx" ON "touma_trade_eligibility_checks"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "touma_trade_documents_tradeOrderId_kind_idx" ON "touma_trade_documents"("tradeOrderId", "kind");

-- CreateIndex
CREATE INDEX "touma_trade_documents_status_idx" ON "touma_trade_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_trade_documents_number_key" ON "touma_trade_documents"("number");

-- CreateIndex
CREATE INDEX "touma_trade_cost_estimates_tradeOrderId_createdAt_idx" ON "touma_trade_cost_estimates"("tradeOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_fx_rate_snapshots_baseCurrency_quoteCurrency_rateAt_idx" ON "touma_fx_rate_snapshots"("baseCurrency", "quoteCurrency", "rateAt");

-- CreateIndex
CREATE INDEX "touma_trade_events_tradeOrderId_occurredAt_idx" ON "touma_trade_events"("tradeOrderId", "occurredAt");

-- CreateIndex
CREATE INDEX "touma_trade_events_kind_occurredAt_idx" ON "touma_trade_events"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "touma_trade_shipment_exceptions_tradeOrderId_raisedAt_idx" ON "touma_trade_shipment_exceptions"("tradeOrderId", "raisedAt");

-- CreateIndex
CREATE INDEX "touma_trade_shipment_exceptions_kind_idx" ON "touma_trade_shipment_exceptions"("kind");

-- AddForeignKey
ALTER TABLE "touma_trade_country_configs" ADD CONSTRAINT "touma_trade_country_configs_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_rule_versions" ADD CONSTRAINT "touma_trade_rule_versions_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "touma_trade_corridors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cross_border_product_rules" ADD CONSTRAINT "touma_cross_border_product_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cross_border_product_rules" ADD CONSTRAINT "touma_cross_border_product_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "touma_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_orders" ADD CONSTRAINT "touma_trade_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_orders" ADD CONSTRAINT "touma_trade_orders_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "touma_trade_corridors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_orders" ADD CONSTRAINT "touma_trade_orders_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "touma_trade_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_routes" ADD CONSTRAINT "touma_trade_routes_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "touma_trade_corridors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_eligibility_checks" ADD CONSTRAINT "touma_trade_eligibility_checks_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "touma_trade_corridors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_eligibility_checks" ADD CONSTRAINT "touma_trade_eligibility_checks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_documents" ADD CONSTRAINT "touma_trade_documents_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "touma_trade_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_cost_estimates" ADD CONSTRAINT "touma_trade_cost_estimates_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "touma_trade_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_events" ADD CONSTRAINT "touma_trade_events_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "touma_trade_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_trade_shipment_exceptions" ADD CONSTRAINT "touma_trade_shipment_exceptions_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "touma_trade_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
