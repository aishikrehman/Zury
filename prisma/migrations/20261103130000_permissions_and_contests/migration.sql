-- CreateTable
CREATE TABLE "UserGlobalRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" INTEGER,
    CONSTRAINT "UserGlobalRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGlobalRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserWikiRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "wiki" TEXT NOT NULL,
    "rightName" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationSource" TEXT NOT NULL,
    CONSTRAINT "UserWikiRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "primaryWiki" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContestMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" INTEGER,
    CONSTRAINT "ContestMembership_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestMembership_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContestPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    CONSTRAINT "ContestPermission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actorId" INTEGER,
    "contestId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "preferredLanguage" TEXT,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "rightsCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_User" ("avatarUrl", "createdAt", "homeWiki", "id", "lastLoginAt", "preferredLanguage", "status", "timezone", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt") SELECT "avatarUrl", "createdAt", "homeWiki", "id", "lastLoginAt", "preferredLanguage", "status", "timezone", "updatedAt", "username", "wikimediaId", "wikimediaRegisteredAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_wikimediaId_key" ON "User"("wikimediaId");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UserGlobalRole_userId_role_key" ON "UserGlobalRole"("userId", "role");

-- CreateIndex
CREATE INDEX "UserWikiRole_wiki_rightName_idx" ON "UserWikiRole"("wiki", "rightName");

-- CreateIndex
CREATE UNIQUE INDEX "UserWikiRole_userId_wiki_rightName_key" ON "UserWikiRole"("userId", "wiki", "rightName");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");

-- CreateIndex
CREATE INDEX "Contest_status_visibility_idx" ON "Contest"("status", "visibility");

-- CreateIndex
CREATE INDEX "Contest_primaryWiki_idx" ON "Contest"("primaryWiki");

-- CreateIndex
CREATE INDEX "ContestMembership_userId_idx" ON "ContestMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestMembership_contestId_userId_role_key" ON "ContestMembership"("contestId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ContestPermission_contestId_userId_permission_key" ON "ContestPermission"("contestId", "userId", "permission");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_contestId_idx" ON "AuditLog"("contestId");
