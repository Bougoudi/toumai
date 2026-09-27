-- CreateTable
CREATE TABLE "touma_search_queries" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "rawTerm" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_search_queries_term_idx" ON "touma_search_queries"("term");

-- CreateIndex
CREATE INDEX "touma_search_queries_createdAt_idx" ON "touma_search_queries"("createdAt");
