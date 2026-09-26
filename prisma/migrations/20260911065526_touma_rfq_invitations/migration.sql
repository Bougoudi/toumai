-- CreateTable
CREATE TABLE "touma_rfq_invitations" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "invitedById" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_rfq_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_rfq_invitations_storeId_idx" ON "touma_rfq_invitations"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_rfq_invitations_rfqId_storeId_key" ON "touma_rfq_invitations"("rfqId", "storeId");

-- AddForeignKey
ALTER TABLE "touma_rfq_invitations" ADD CONSTRAINT "touma_rfq_invitations_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "touma_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfq_invitations" ADD CONSTRAINT "touma_rfq_invitations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_rfq_invitations" ADD CONSTRAINT "touma_rfq_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
