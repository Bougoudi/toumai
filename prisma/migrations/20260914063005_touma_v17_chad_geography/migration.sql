-- CreateEnum
CREATE TYPE "LocalityType" AS ENUM ('CITY', 'TOWN', 'DISTRICT', 'VILLAGE', 'RURAL_AREA', 'LOCALITY', 'OTHER');

-- AlterTable
ALTER TABLE "touma_addresses" ADD COLUMN     "alternativePhone" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "localityId" TEXT,
ADD COLUMN     "provinceId" TEXT,
ADD COLUMN     "subPrefectureId" TEXT;

-- AlterTable
ALTER TABLE "touma_countries" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "touma_pickup_points" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "localityId" TEXT,
ADD COLUMN     "provinceId" TEXT;

-- AlterTable
ALTER TABLE "touma_stores" ADD COLUMN     "localityId" TEXT,
ADD COLUMN     "provinceId" TEXT;

-- CreateTable
CREATE TABLE "touma_provinces" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sourceId" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_departments" (
    "id" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sourceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_sub_prefectures" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "sourceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_sub_prefectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_localities" (
    "id" TEXT NOT NULL,
    "provinceId" TEXT NOT NULL,
    "departmentId" TEXT,
    "subPrefectureId" TEXT,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "LocalityType" NOT NULL DEFAULT 'LOCALITY',
    "sourceId" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "population" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_localities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "touma_provinces_countryCode_idx" ON "touma_provinces"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "touma_provinces_countryCode_code_key" ON "touma_provinces"("countryCode", "code");

-- CreateIndex
CREATE INDEX "touma_departments_provinceId_idx" ON "touma_departments"("provinceId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_departments_provinceId_code_key" ON "touma_departments"("provinceId", "code");

-- CreateIndex
CREATE INDEX "touma_sub_prefectures_departmentId_idx" ON "touma_sub_prefectures"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_localities_sourceId_key" ON "touma_localities"("sourceId");

-- CreateIndex
CREATE INDEX "touma_localities_provinceId_idx" ON "touma_localities"("provinceId");

-- CreateIndex
CREATE INDEX "touma_localities_departmentId_idx" ON "touma_localities"("departmentId");

-- CreateIndex
CREATE INDEX "touma_localities_provinceId_name_idx" ON "touma_localities"("provinceId", "name");

-- CreateIndex
CREATE INDEX "touma_addresses_provinceId_idx" ON "touma_addresses"("provinceId");

-- CreateIndex
CREATE INDEX "touma_addresses_localityId_idx" ON "touma_addresses"("localityId");

-- CreateIndex
CREATE INDEX "touma_pickup_points_provinceId_idx" ON "touma_pickup_points"("provinceId");

-- CreateIndex
CREATE INDEX "touma_stores_provinceId_idx" ON "touma_stores"("provinceId");

-- CreateIndex
CREATE INDEX "touma_stores_countryCode_provinceId_idx" ON "touma_stores"("countryCode", "provinceId");

-- AddForeignKey
ALTER TABLE "touma_provinces" ADD CONSTRAINT "touma_provinces_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_departments" ADD CONSTRAINT "touma_departments_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_sub_prefectures" ADD CONSTRAINT "touma_sub_prefectures_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_localities" ADD CONSTRAINT "touma_localities_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_localities" ADD CONSTRAINT "touma_localities_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_localities" ADD CONSTRAINT "touma_localities_subPrefectureId_fkey" FOREIGN KEY ("subPrefectureId") REFERENCES "touma_sub_prefectures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_subPrefectureId_fkey" FOREIGN KEY ("subPrefectureId") REFERENCES "touma_sub_prefectures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "touma_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stores" ADD CONSTRAINT "touma_stores_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stores" ADD CONSTRAINT "touma_stores_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "touma_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_pickup_points" ADD CONSTRAINT "touma_pickup_points_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "touma_provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_pickup_points" ADD CONSTRAINT "touma_pickup_points_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "touma_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_pickup_points" ADD CONSTRAINT "touma_pickup_points_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "touma_localities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
