-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "statusMode" TEXT NOT NULL DEFAULT 'auto',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "organizingCommunity" TEXT NOT NULL DEFAULT '',
    "primaryWiki" TEXT NOT NULL,
    "additionalWikis" TEXT NOT NULL DEFAULT '[]',
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "contactInfo" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "previousEditionUrl" TEXT NOT NULL DEFAULT '',
    "mainCategory" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "registrationOpensAt" DATETIME,
    "registrationClosesAt" DATETIME,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "submissionOpensAt" DATETIME,
    "submissionDeadline" DATETIME,
    "reviewOpensAt" DATETIME,
    "reviewDeadline" DATETIME,
    "appealDeadline" DATETIME,
    "resultsAnnouncedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" INTEGER,
    "edition" TEXT,
    "createdById" INTEGER,
    "deletedAt" DATETIME,
    "deletedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contest_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contest_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contest" ("additionalWikis", "appealDeadline", "bannerUrl", "contactInfo", "createdAt", "createdById", "deletedAt", "deletedById", "description", "edition", "endDate", "id", "isDemo", "language", "logoUrl", "organizingCommunity", "primaryWiki", "registrationClosesAt", "registrationOpensAt", "resultsAnnouncedAt", "reviewDeadline", "reviewOpensAt", "seriesId", "slug", "startDate", "status", "statusMode", "submissionDeadline", "submissionOpensAt", "timezone", "title", "type", "updatedAt", "visibility") SELECT "additionalWikis", "appealDeadline", "bannerUrl", "contactInfo", "createdAt", "createdById", "deletedAt", "deletedById", "description", "edition", "endDate", "id", "isDemo", "language", "logoUrl", "organizingCommunity", "primaryWiki", "registrationClosesAt", "registrationOpensAt", "resultsAnnouncedAt", "reviewDeadline", "reviewOpensAt", "seriesId", "slug", "startDate", "status", "statusMode", "submissionDeadline", "submissionOpensAt", "timezone", "title", "type", "updatedAt", "visibility" FROM "Contest";
DROP TABLE "Contest";
ALTER TABLE "new_Contest" RENAME TO "Contest";
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");
CREATE INDEX "Contest_status_visibility_idx" ON "Contest"("status", "visibility");
CREATE INDEX "Contest_primaryWiki_idx" ON "Contest"("primaryWiki");
CREATE INDEX "Contest_deletedAt_idx" ON "Contest"("deletedAt");
CREATE UNIQUE INDEX "Contest_seriesId_edition_key" ON "Contest"("seriesId", "edition");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

