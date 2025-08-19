/*
  Warnings:

  - You are about to drop the column `firePlanImage` on the `Floor` table. All the data in the column will be lost.
  - You are about to drop the column `planImage` on the `Floor` table. All the data in the column will be lost.
  - The `status` column on the `Zone` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[officeId,number]` on the table `Floor` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `type` to the `Layer` table without a default value. This is not possible if the table is not empty.
  - Made the column `name` on table `Zone` required. This step will fail if there are existing NULL values in that column.
  - Made the column `description` on table `Zone` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "LayerType" AS ENUM ('firesafe', 'custom');

-- CreateEnum
CREATE TYPE "ZoneStatus" AS ENUM ('free', 'occupied');

-- DropForeignKey
ALTER TABLE "Floor" DROP CONSTRAINT "Floor_officeId_fkey";

-- DropForeignKey
ALTER TABLE "Layer" DROP CONSTRAINT "Layer_floorId_fkey";

-- DropForeignKey
ALTER TABLE "Zone" DROP CONSTRAINT "Zone_layerId_fkey";

-- AlterTable
ALTER TABLE "Floor" DROP COLUMN "firePlanImage",
DROP COLUMN "planImage",
ADD COLUMN     "firesafeImageUrl" TEXT,
ADD COLUMN     "planImageUrl" TEXT;

-- AlterTable
ALTER TABLE "Layer" ADD COLUMN     "type" "LayerType" NOT NULL;

-- AlterTable
ALTER TABLE "Office" ALTER COLUMN "name" SET DEFAULT 'Office';

-- AlterTable
ALTER TABLE "Zone" ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "name" SET DEFAULT '',
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "description" SET DEFAULT '',
DROP COLUMN "status",
ADD COLUMN     "status" "ZoneStatus" NOT NULL DEFAULT 'free';

-- CreateIndex
CREATE INDEX "Floor_officeId_idx" ON "Floor"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_officeId_number_key" ON "Floor"("officeId", "number");

-- CreateIndex
CREATE INDEX "Layer_floorId_idx" ON "Layer"("floorId");

-- CreateIndex
CREATE INDEX "Zone_layerId_idx" ON "Zone"("layerId");

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Layer" ADD CONSTRAINT "Layer_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "Layer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
