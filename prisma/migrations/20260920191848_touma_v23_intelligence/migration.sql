-- CreateEnum
CREATE TYPE "AiTaskKind" AS ENUM ('CLASSIFY', 'GENERATE', 'STRUCTURED', 'EMBED', 'MODERATE', 'TRANSLATE', 'REASON');

-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('READ_ONLY', 'LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiConversationSurface" AS ENUM ('BUYER', 'SELLER', 'BUSINESS', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AiMemoryKind" AS ENUM ('SESSION', 'PREFERENCE', 'TASK');

-- CreateEnum
CREATE TYPE "AiFeedbackVerdict" AS ENUM ('HELPFUL', 'NOT_HELPFUL', 'INCORRECT', 'OUTDATED', 'IRRELEVANT', 'UNSAFE', 'WRONG_PRODUCT', 'WRONG_PRICE');

-- CreateEnum
CREATE TYPE "AiConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('DEMAND', 'INVENTORY', 'PRICE_ANOMALY', 'SELLER_PERFORMANCE', 'FRAUD_SIGNAL', 'MARKETING');

-- CreateTable
CREATE TABLE "touma_ai_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "surface" "AiConversationSurface" NOT NULL DEFAULT 'BUYER',
    "title" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "scopeId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "provider" TEXT,
    "model" TEXT,
    "injectionScore" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_tool_calls" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,
    "tool" TEXT NOT NULL,
    "riskLevel" "AiRiskLevel" NOT NULL DEFAULT 'READ_ONLY',
    "argsHash" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "confirmationId" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "scopeId" TEXT,
    "feature" TEXT NOT NULL,
    "task" "AiTaskKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_feedback" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT,
    "verdict" "AiFeedbackVerdict" NOT NULL,
    "comment" TEXT,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_evaluations" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "task" "AiTaskKind" NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "toolFailures" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "notHelpful" INTEGER NOT NULL DEFAULT 0,
    "hallucinations" INTEGER NOT NULL DEFAULT 0,
    "p95LatencyMs" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_ai_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AiMemoryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "scopeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_insights" (
    "id" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "suggestion" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_action_confirmations" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "riskLevel" "AiRiskLevel" NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL,
    "status" "AiConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_action_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "produced" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_ai_conversations_userId_lastMessageAt_idx" ON "touma_ai_conversations"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "touma_ai_messages_conversationId_createdAt_idx" ON "touma_ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_tool_calls_conversationId_createdAt_idx" ON "touma_ai_tool_calls"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_tool_calls_tool_createdAt_idx" ON "touma_ai_tool_calls"("tool", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_tool_calls_userId_createdAt_idx" ON "touma_ai_tool_calls"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_usage_userId_day_idx" ON "touma_ai_usage"("userId", "day");

-- CreateIndex
CREATE INDEX "touma_ai_usage_scopeId_day_idx" ON "touma_ai_usage"("scopeId", "day");

-- CreateIndex
CREATE INDEX "touma_ai_usage_feature_createdAt_idx" ON "touma_ai_usage"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_usage_provider_model_createdAt_idx" ON "touma_ai_usage"("provider", "model", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_feedback_verdict_createdAt_idx" ON "touma_ai_feedback"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_feedback_messageId_idx" ON "touma_ai_feedback"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ai_evaluations_feature_task_day_key" ON "touma_ai_evaluations"("feature", "task", "day");

-- CreateIndex
CREATE INDEX "touma_ai_memories_expiresAt_idx" ON "touma_ai_memories"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ai_memories_userId_kind_key_key" ON "touma_ai_memories"("userId", "kind", "key");

-- CreateIndex
CREATE INDEX "touma_ai_insights_subjectType_subjectId_createdAt_idx" ON "touma_ai_insights"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "touma_ai_insights_kind_createdAt_idx" ON "touma_ai_insights"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ai_insights_kind_subjectType_subjectId_code_windowEnd_key" ON "touma_ai_insights"("kind", "subjectType", "subjectId", "code", "windowEnd");

-- CreateIndex
CREATE INDEX "touma_ai_action_confirmations_userId_status_idx" ON "touma_ai_action_confirmations"("userId", "status");

-- CreateIndex
CREATE INDEX "touma_ai_action_confirmations_status_expiresAt_idx" ON "touma_ai_action_confirmations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "touma_ai_prompt_versions_feature_active_idx" ON "touma_ai_prompt_versions"("feature", "active");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ai_prompt_versions_feature_version_key" ON "touma_ai_prompt_versions"("feature", "version");

-- CreateIndex
CREATE INDEX "touma_ai_job_runs_job_createdAt_idx" ON "touma_ai_job_runs"("job", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "touma_ai_job_runs_job_windowEnd_key" ON "touma_ai_job_runs"("job", "windowEnd");

-- AddForeignKey
ALTER TABLE "touma_ai_conversations" ADD CONSTRAINT "touma_ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_messages" ADD CONSTRAINT "touma_ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_tool_calls" ADD CONSTRAINT "touma_ai_tool_calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_tool_calls" ADD CONSTRAINT "touma_ai_tool_calls_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "touma_ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_tool_calls" ADD CONSTRAINT "touma_ai_tool_calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_usage" ADD CONSTRAINT "touma_ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_usage" ADD CONSTRAINT "touma_ai_usage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_feedback" ADD CONSTRAINT "touma_ai_feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_feedback" ADD CONSTRAINT "touma_ai_feedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "touma_ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_feedback" ADD CONSTRAINT "touma_ai_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_memories" ADD CONSTRAINT "touma_ai_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_action_confirmations" ADD CONSTRAINT "touma_ai_action_confirmations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "touma_ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_action_confirmations" ADD CONSTRAINT "touma_ai_action_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une seule invite active par fonctionnalité.
--
-- Prisma ne sait pas exprimer un index unique partiel. Le poser ici plutôt que
-- de le vérifier dans un service est la seule façon qu'il tienne quand deux
-- administrateurs activent deux versions en même temps : sans lui, la dernière
-- écriture gagnerait en silence et deux invites seraient actives à la fois pour
-- la même fonctionnalité — donc deux comportements possibles, sans trace de
-- lequel a répondu.
CREATE UNIQUE INDEX "touma_ai_prompt_versions_feature_active_key"
  ON "touma_ai_prompt_versions" ("feature")
  WHERE "active";
