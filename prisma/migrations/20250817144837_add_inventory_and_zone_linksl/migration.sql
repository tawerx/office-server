-- CreateTable
CREATE TABLE "ZoneObject" (
    "id" SERIAL NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "zoneInventoryId" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ZoneObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoneObject_zoneInventoryId_idx" ON "ZoneObject"("zoneInventoryId");

-- AddForeignKey
ALTER TABLE "ZoneObject" ADD CONSTRAINT "ZoneObject_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneObject" ADD CONSTRAINT "ZoneObject_zoneInventoryId_fkey" FOREIGN KEY ("zoneInventoryId") REFERENCES "ZoneInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
