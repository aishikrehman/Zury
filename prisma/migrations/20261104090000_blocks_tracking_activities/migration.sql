-- CreateTable
CREATE TABLE "EventBlock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "blockedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" DATETIME,
    CONSTRAINT "EventBlock_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventBlock_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "wiki" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "mode" TEXT NOT NULL DEFAULT 'offline',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "location" TEXT NOT NULL DEFAULT '',
    "meetingUrl" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER,
    "agenda" TEXT NOT NULL DEFAULT '',
    "report" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventSession_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInAt" DATETIME,
    CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "wiki" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "pageTitle" TEXT NOT NULL,
    "ns" INTEGER NOT NULL DEFAULT 0,
    "revId" INTEGER,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "sizeDiff" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT NOT NULL DEFAULT '',
    "timestamp" DATETIME NOT NULL,
    "foundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contribution_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContestSettings" (
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
    "trackHashtags" TEXT NOT NULL DEFAULT '[]',
    "trackCategories" TEXT NOT NULL DEFAULT '[]',
    "trackedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContestSettings_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContestSettings" ("allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "typeConfig", "updatedAt") SELECT "allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "typeConfig", "updatedAt" FROM "ContestSettings";
DROP TABLE "ContestSettings";
ALTER TABLE "new_ContestSettings" RENAME TO "ContestSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EventBlock_contestId_userId_idx" ON "EventBlock"("contestId", "userId");

-- CreateIndex
CREATE INDEX "EventSession_contestId_startsAt_idx" ON "EventSession"("contestId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttendance_sessionId_userId_key" ON "SessionAttendance"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "Contribution_contestId_wiki_idx" ON "Contribution"("contestId", "wiki");

-- CreateIndex
CREATE INDEX "Contribution_contestId_username_idx" ON "Contribution"("contestId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_contestId_key_key" ON "Contribution"("contestId", "key");

