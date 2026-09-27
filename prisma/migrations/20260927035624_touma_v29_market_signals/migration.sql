-- CreateEnum
CREATE TYPE "MarketSignalSubject" AS ENUM ('PRODUCT');

-- CreateEnum
CREATE TYPE "MarketWatchScope" AS ENUM ('PRODUCT', 'STORE');

-- CreateTable
CREATE TABLE "touma_market_signals" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" "MarketSignalSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "measured" JSONB NOT NULL DEFAULT '{}',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "openKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_market_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_market_watches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "scope" "MarketWatchScope" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mutedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_market_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_market_alerts" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_market_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_market_signals_openKey_key" ON "touma_market_signals"("openKey");

-- CreateIndex
CREATE INDEX "touma_market_signals_storeId_resolvedAt_idx" ON "touma_market_signals"("storeId", "resolvedAt");

-- CreateIndex
CREATE INDEX "touma_market_signals_subjectType_subjectId_resolvedAt_idx" ON "touma_market_signals"("subjectType", "subjectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "touma_market_signals_kind_resolvedAt_idx" ON "touma_market_signals"("kind", "resolvedAt");

-- CreateIndex
CREATE INDEX "touma_market_watches_storeId_idx" ON "touma_market_watches"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_market_watches_userId_storeId_scope_subjectId_key" ON "touma_market_watches"("userId", "storeId", "scope", "subjectId");

-- CreateIndex
CREATE INDEX "touma_market_alerts_userId_sentAt_idx" ON "touma_market_alerts"("userId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_market_alerts_signalId_watchId_key" ON "touma_market_alerts"("signalId", "watchId");

-- AddForeignKey
ALTER TABLE "touma_market_signals" ADD CONSTRAINT "touma_market_signals_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_market_watches" ADD CONSTRAINT "touma_market_watches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_market_watches" ADD CONSTRAINT "touma_market_watches_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_market_alerts" ADD CONSTRAINT "touma_market_alerts_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "touma_market_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_market_alerts" ADD CONSTRAINT "touma_market_alerts_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "touma_market_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
