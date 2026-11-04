-- AlterTable
ALTER TABLE "Contest" ADD COLUMN "resultsPublishedAt" DATETIME;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "score" REAL;

-- CreateTable
CREATE TABLE "Review" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "jurorId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "marks" TEXT NOT NULL DEFAULT '{}',
    "points" REAL NOT NULL DEFAULT 0,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Review_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_jurorId_fkey" FOREIGN KEY ("jurorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contestId" INTEGER NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "response" TEXT NOT NULL DEFAULT '',
    "resolvedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Appeal_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appeal_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appeal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "marks" TEXT NOT NULL DEFAULT '[]',
    "requiredReviews" INTEGER NOT NULL DEFAULT 1,
    "trackedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContestSettings_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContestSettings" ("allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "marks", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "trackCategories", "trackHashtags", "trackedAt", "typeConfig", "updatedAt") SELECT "allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "marks", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "trackCategories", "trackHashtags", "trackedAt", "typeConfig", "updatedAt" FROM "ContestSettings";
DROP TABLE "ContestSettings";
ALTER TABLE "new_ContestSettings" RENAME TO "ContestSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Review_contestId_jurorId_idx" ON "Review"("contestId", "jurorId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_submissionId_jurorId_key" ON "Review"("submissionId", "jurorId");

-- CreateIndex
CREATE INDEX "Appeal_contestId_status_idx" ON "Appeal"("contestId", "status");

