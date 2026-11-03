-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wikimediaId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "homeWiki" TEXT,
    "preferredLanguage" TEXT,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wikimediaId_key" ON "User"("wikimediaId");
