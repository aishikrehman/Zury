-- AlterTable
ALTER TABLE "User" ADD COLUMN "globalEditCount" INTEGER;

-- CreateTable
CREATE TABLE "ContestSettings" (
    "contestId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "juryReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "appealsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "registrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "massSubmissionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoValidationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "contributionDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "badgesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicStatisticsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "participantNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "registrationRequired" BOOLEAN NOT NULL DEFAULT false,
    "participationMode" TEXT NOT NULL DEFAULT 'individual',
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "minEditCount" INTEGER NOT NULL DEFAULT 0,
    "participantLimit" INTEGER,
    "allowJuryParticipation" BOOLEAN NOT NULL DEFAULT false,
    "allowOrganizerParticipation" BOOLEAN NOT NULL DEFAULT false,
    "anonymousParticipants" BOOLEAN NOT NULL DEFAULT false,
    "eligibleNamespaces" TEXT NOT NULL DEFAULT '[]',
    "typeConfig" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContestSettings_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "createdById" INTEGER,
    "deletedAt" DATETIME,
    "deletedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contest_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Contest" ("createdAt", "createdById", "description", "endDate", "id", "isDemo", "language", "primaryWiki", "slug", "startDate", "status", "timezone", "title", "type", "updatedAt", "visibility") SELECT "createdAt", "createdById", "description", "endDate", "id", "isDemo", "language", "primaryWiki", "slug", "startDate", "status", "timezone", "title", "type", "updatedAt", "visibility" FROM "Contest";
DROP TABLE "Contest";
ALTER TABLE "new_Contest" RENAME TO "Contest";
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");
CREATE INDEX "Contest_status_visibility_idx" ON "Contest"("status", "visibility");
CREATE INDEX "Contest_primaryWiki_idx" ON "Contest"("primaryWiki");
CREATE INDEX "Contest_deletedAt_idx" ON "Contest"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

