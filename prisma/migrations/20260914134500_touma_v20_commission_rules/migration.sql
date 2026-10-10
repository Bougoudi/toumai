-- AlterTable
ALTER TABLE "touma_orders" ADD COLUMN     "commissionRate" DECIMAL(9,6) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "touma_commission_rules" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT,
    "categoryId" TEXT,
    "storeId" TEXT,
    "rate" DECIMAL(9,6) NOT NULL,
    "minFee" DECIMAL(18,4),
    "maxFee" DECIMAL(18,4),
    "feeCurrency" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_commission_rules_countryCode_effectiveFrom_idx" ON "touma_commission_rules"("countryCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "touma_commission_rules_categoryId_idx" ON "touma_commission_rules"("categoryId");

-- CreateIndex
CREATE INDEX "touma_commission_rules_storeId_idx" ON "touma_commission_rules"("storeId");

-- CreateIndex
CREATE INDEX "touma_commission_rules_active_effectiveFrom_idx" ON "touma_commission_rules"("active", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "touma_commission_rules" ADD CONSTRAINT "touma_commission_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "touma_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_commission_rules" ADD CONSTRAINT "touma_commission_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_commission_rules" ADD CONSTRAINT "touma_commission_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Reprise des commandes existantes.
--
-- Le défaut de colonne est 0, mais une commande déjà passée porte une
-- commission non nulle : laisser son taux à zéro ferait enregistrer, à
-- l'encaissement ou à la contre-passation, un taux qui contredit le montant.
--
-- Le taux réellement appliqué n'a pas à être deviné : il se déduit des montants
-- déjà écrits. L'assiette est le sous-total diminué de la remise financée par
-- le vendeur — la même que celle du calcul d'origine.
UPDATE "touma_orders"
   SET "commissionRate" = ROUND("commissionTotal" / ("subtotal" - "sellerFundedDiscount"), 6)
 WHERE ("subtotal" - "sellerFundedDiscount") > 0;
