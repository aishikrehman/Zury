-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wikimediaId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "homeWiki" TEXT,
    "wikimediaRegisteredAt" DATETIME,
    "globalEditCount" INTEGER,
    "preferredLanguage" TEXT,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "rightsCheckedAt" DATETIME,
    "uiLayout" TEXT,
    "uiWide" BOOLEAN NOT NULL DEFAULT false,
    "uiTextLarge" BOOLEAN NOT NULL DEFAULT false,
    "uiSidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_User" ("avatarUrl", "createdAt", "globalEditCount", "homeWiki", "id", "isDemo", "lastLoginAt", "preferredLanguage", "rightsCheckedAt", "status", "timezone", "uiLayout", "uiTextLarge", "uiWide", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt") SELECT "avatarUrl", "createdAt", "globalEditCount", "homeWiki", "id", "isDemo", "lastLoginAt", "preferredLanguage", "rightsCheckedAt", "status", "timezone", "uiLayout", "uiTextLarge", "uiWide", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_wikimediaId_key" ON "User"("wikimediaId");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

