-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "touma_account_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reason" TEXT,
    "blockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "touma_account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_account_deletion_requests_userId_idx" ON "touma_account_deletion_requests"("userId");

-- CreateIndex
CREATE INDEX "touma_account_deletion_requests_status_scheduledFor_idx" ON "touma_account_deletion_requests"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "touma_account_deletion_requests" ADD CONSTRAINT "touma_account_deletion_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
