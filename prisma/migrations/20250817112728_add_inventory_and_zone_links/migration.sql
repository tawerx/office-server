/*
  Warnings:

  - Added the required column `floorId` to the `Zone` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Floor_officeId_idx";

-- DropIndex
DROP INDEX "Layer_floorId_idx";

-- DropIndex
DROP INDEX "Zone_layerId_idx";

-- AlterTable
ALTER TABLE "Office" ADD COLUMN     "city" TEXT,
ALTER COLUMN "name" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "floorId" INTEGER NOT NULL,
ALTER COLUMN "name" DROP DEFAULT;

-- CreateTable
CREATE TABLE "InventoryCatalog" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "InventoryCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorInventory" (
    "id" SERIAL NOT NULL,
    "floorId" INTEGER NOT NULL,
    "catalogId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FloorInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneInventory" (
    "id" SERIAL NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "floorInventoryId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ZoneInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FloorInventory_floorId_catalogId_key" ON "FloorInventory"("floorId", "catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneInventory_zoneId_floorInventoryId_key" ON "ZoneInventory"("zoneId", "floorInventoryId");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorInventory" ADD CONSTRAINT "FloorInventory_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorInventory" ADD CONSTRAINT "FloorInventory_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "InventoryCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneInventory" ADD CONSTRAINT "ZoneInventory_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneInventory" ADD CONSTRAINT "ZoneInventory_floorInventoryId_fkey" FOREIGN KEY ("floorInventoryId") REFERENCES "FloorInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
