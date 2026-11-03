-- AlterTable
ALTER TABLE "User" ADD COLUMN "wikimediaRegisteredAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

