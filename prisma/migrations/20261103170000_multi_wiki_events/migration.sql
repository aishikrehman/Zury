-- CreateTable
CREATE TABLE "EventSeries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContestWiki" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "wiki" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "overrides" TEXT NOT NULL DEFAULT '{}',
    "requestedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContestWiki_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
INSERT INTO "new_Contest" ("additionalWikis", "appealDeadline", "bannerUrl", "contactInfo", "createdAt", "createdById", "deletedAt", "deletedById", "description", "endDate", "id", "isDemo", "language", "logoUrl", "organizingCommunity", "primaryWiki", "registrationClosesAt", "registrationOpensAt", "resultsAnnouncedAt", "reviewDeadline", "reviewOpensAt", "slug", "startDate", "status", "statusMode", "submissionDeadline", "submissionOpensAt", "timezone", "title", "type", "updatedAt", "visibility") SELECT "additionalWikis", "appealDeadline", "bannerUrl", "contactInfo", "createdAt", "createdById", "deletedAt", "deletedById", "description", "endDate", "id", "isDemo", "language", "logoUrl", "organizingCommunity", "primaryWiki", "registrationClosesAt", "registrationOpensAt", "resultsAnnouncedAt", "reviewDeadline", "reviewOpensAt", "slug", "startDate", "status", "statusMode", "submissionDeadline", "submissionOpensAt", "timezone", "title", "type", "updatedAt", "visibility" FROM "Contest";
DROP TABLE "Contest";
ALTER TABLE "new_Contest" RENAME TO "Contest";
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");
CREATE INDEX "Contest_status_visibility_idx" ON "Contest"("status", "visibility");
CREATE INDEX "Contest_primaryWiki_idx" ON "Contest"("primaryWiki");
CREATE INDEX "Contest_deletedAt_idx" ON "Contest"("deletedAt");
CREATE UNIQUE INDEX "Contest_seriesId_edition_key" ON "Contest"("seriesId", "edition");
CREATE TABLE "new_ContestMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "wiki" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" INTEGER,
    CONSTRAINT "ContestMembership_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContestMembership_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ContestMembership" ("assignedAt", "assignedById", "contestId", "id", "role", "status", "userId") SELECT "assignedAt", "assignedById", "contestId", "id", "role", "status", "userId" FROM "ContestMembership";
DROP TABLE "ContestMembership";
ALTER TABLE "new_ContestMembership" RENAME TO "ContestMembership";
CREATE INDEX "ContestMembership_userId_idx" ON "ContestMembership"("userId");
CREATE UNIQUE INDEX "ContestMembership_contestId_userId_role_wiki_key" ON "ContestMembership"("contestId", "userId", "role", "wiki");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_slug_key" ON "EventSeries"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContestWiki_contestId_wiki_key" ON "ContestWiki"("contestId", "wiki");

-- CreateIndex
CREATE UNIQUE INDEX "ContestWiki_contestId_code_key" ON "ContestWiki"("contestId", "code");


-- Backfill: every existing event takes part in its primary and additional wikis.
-- Wikipedias get their language code ("bnwiki" -> "bn"); other wikis keep the database name.
INSERT OR IGNORE INTO "ContestWiki" ("contestId", "wiki", "code", "status", "overrides", "createdAt", "updatedAt")
SELECT c."id", w.wiki,
       CASE WHEN w.wiki LIKE '%wiki' AND w.wiki NOT IN ('commonswiki','wikidatawiki','metawiki','specieswiki','mediawikiwiki','sourceswiki')
            THEN replace(substr(w.wiki, 1, length(w.wiki) - 4), '_', '-')
            ELSE w.wiki END,
       'active', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Contest" c
JOIN (
  SELECT "id" AS cid, "primaryWiki" AS wiki FROM "Contest"
  UNION
  SELECT c2."id", j.value FROM "Contest" c2, json_each(c2."additionalWikis") j
) w ON w.cid = c."id";
