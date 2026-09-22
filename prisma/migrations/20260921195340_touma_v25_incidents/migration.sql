-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentEventKind" AS ENUM ('OBSERVATION', 'ACTION', 'STATUS', 'COMMUNICATION');

-- CreateTable
CREATE TABLE "touma_incidents" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "impact" TEXT,
    "component" TEXT,
    "ownerId" TEXT,
    "openedById" TEXT,
    "rootCause" TEXT,
    "resolution" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mitigatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_incident_events" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" "IncidentEventKind" NOT NULL,
    "note" TEXT NOT NULL,
    "fromStatus" "IncidentStatus",
    "toStatus" "IncidentStatus",
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "touma_incidents_reference_key" ON "touma_incidents"("reference");

-- CreateIndex
CREATE INDEX "touma_incidents_status_severity_idx" ON "touma_incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "touma_incidents_detectedAt_idx" ON "touma_incidents"("detectedAt");

-- CreateIndex
CREATE INDEX "touma_incident_events_incidentId_createdAt_idx" ON "touma_incident_events"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "touma_incidents" ADD CONSTRAINT "touma_incidents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_incidents" ADD CONSTRAINT "touma_incidents_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_incident_events" ADD CONSTRAINT "touma_incident_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "touma_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_incident_events" ADD CONSTRAINT "touma_incident_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
