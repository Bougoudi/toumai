-- AlterTable
ALTER TABLE "touma_products" ADD COLUMN     "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

