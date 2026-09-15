-- CreateTable
CREATE TABLE "touma_store_reputations" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ordersPaid" INTEGER NOT NULL DEFAULT 0,
    "ordersDelivered" INTEGER NOT NULL DEFAULT 0,
    "onTimeRate" DECIMAL(5,4),
    "cancellationRate" DECIMAL(5,4),
    "disputeRate" DECIMAL(5,4),
    "returnRate" DECIMAL(5,4),
    "responseRate" DECIMAL(5,4),
    "avgPreparationHours" DECIMAL(10,2),
    "avgDeliveryDays" DECIMAL(10,2),
    "medianResponseHours" DECIMAL(10,2),
    "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "level" TEXT NOT NULL DEFAULT 'NOUVEAU',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_store_reputations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_store_reputations_storeId_key" ON "touma_store_reputations"("storeId");

-- AddForeignKey
ALTER TABLE "touma_store_reputations" ADD CONSTRAINT "touma_store_reputations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
