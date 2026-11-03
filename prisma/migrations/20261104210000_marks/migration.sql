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
    "trackedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContestSettings_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContestSettings" ("allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "trackCategories", "trackHashtags", "trackedAt", "typeConfig", "updatedAt") SELECT "allowJuryParticipation", "allowOrganizerParticipation", "anonymousParticipants", "appealsEnabled", "autoValidationEnabled", "badgesEnabled", "contestId", "contributionDiscoveryEnabled", "eligibleNamespaces", "juryReviewEnabled", "massSubmissionEnabled", "minAccountAgeDays", "minEditCount", "participantLimit", "participantNotificationsEnabled", "participationMode", "publicStatisticsEnabled", "registrationEnabled", "registrationRequired", "trackCategories", "trackHashtags", "trackedAt", "typeConfig", "updatedAt" FROM "ContestSettings";
DROP TABLE "ContestSettings";
ALTER TABLE "new_ContestSettings" RENAME TO "ContestSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

