-- CreateTable
CREATE TABLE "touma_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exposedToClient" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_feature_flags_key_key" ON "touma_feature_flags"("key");

-- CreateIndex
CREATE INDEX "touma_feature_flags_enabled_idx" ON "touma_feature_flags"("enabled");

-- AddForeignKey
ALTER TABLE "touma_feature_flags" ADD CONSTRAINT "touma_feature_flags_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
