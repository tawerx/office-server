/*
  Warnings:

  - Added the required column `address` to the `Office` table without a default value. This is not possible if the table is not empty.
  - Added the required column `country` to the `Office` table without a default value. This is not possible if the table is not empty.
  - Made the column `city` on table `Office` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MODERATOR', 'USER');

-- AlterTable
ALTER TABLE "Office" ADD COLUMN     "address" TEXT NOT NULL,
ADD COLUMN     "country" TEXT NOT NULL,
ALTER COLUMN "city" SET NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
