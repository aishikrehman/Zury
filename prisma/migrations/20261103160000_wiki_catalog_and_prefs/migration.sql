-- CreateTable
CREATE TABLE "WikiSite" (
    "dbname" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "sitename" TEXT NOT NULL,
    "lang" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Language" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "localName" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WikiNamespace" (
    "wiki" TEXT NOT NULL,
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "canonical" TEXT,
    "content" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("wiki", "id"),
    CONSTRAINT "WikiNamespace_wiki_fkey" FOREIGN KEY ("wiki") REFERENCES "WikiSite" ("dbname") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_User" ("avatarUrl", "createdAt", "globalEditCount", "homeWiki", "id", "isDemo", "lastLoginAt", "preferredLanguage", "rightsCheckedAt", "status", "timezone", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt") SELECT "avatarUrl", "createdAt", "globalEditCount", "homeWiki", "id", "isDemo", "lastLoginAt", "preferredLanguage", "rightsCheckedAt", "status", "timezone", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_wikimediaId_key" ON "User"("wikimediaId");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WikiSite_lang_idx" ON "WikiSite"("lang");

