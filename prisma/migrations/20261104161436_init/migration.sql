-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wikimediaId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `avatarUrl` TEXT NULL,
    `homeWiki` VARCHAR(191) NULL,
    `wikimediaRegisteredAt` DATETIME(3) NULL,
    `globalEditCount` INTEGER NULL,
    `preferredLanguage` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `rightsCheckedAt` DATETIME(3) NULL,
    `uiLayout` VARCHAR(191) NULL,
    `uiWide` BOOLEAN NOT NULL DEFAULT false,
    `uiTextLarge` BOOLEAN NOT NULL DEFAULT false,
    `uiSidebarCollapsed` BOOLEAN NOT NULL DEFAULT false,
    `uiPrefs` TEXT NOT NULL DEFAULT '{}',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastLoginAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_wikimediaId_key`(`wikimediaId`),
    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserGlobalRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedById` INTEGER NULL,

    UNIQUE INDEX `UserGlobalRole_userId_role_key`(`userId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserWikiRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `wiki` VARCHAR(191) NOT NULL,
    `rightName` VARCHAR(191) NOT NULL,
    `verifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verificationSource` VARCHAR(191) NOT NULL,

    INDEX `UserWikiRole_wiki_rightName_idx`(`wiki`, `rightName`),
    UNIQUE INDEX `UserWikiRole_userId_wiki_rightName_key`(`userId`, `wiki`, `rightName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(1000) NOT NULL,
    `description` TEXT NOT NULL DEFAULT '',
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `statusMode` VARCHAR(191) NOT NULL DEFAULT 'auto',
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
    `organizingCommunity` VARCHAR(191) NOT NULL DEFAULT '',
    `primaryWiki` VARCHAR(191) NOT NULL,
    `additionalWikis` TEXT NOT NULL DEFAULT '[]',
    `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `contactInfo` TEXT NOT NULL DEFAULT '',
    `category` VARCHAR(191) NOT NULL DEFAULT '',
    `previousEditionUrl` TEXT NOT NULL DEFAULT '',
    `mainCategory` TEXT NOT NULL DEFAULT '',
    `logoUrl` TEXT NULL,
    `bannerUrl` TEXT NULL,
    `registrationOpensAt` DATETIME(3) NULL,
    `registrationClosesAt` DATETIME(3) NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `submissionOpensAt` DATETIME(3) NULL,
    `submissionDeadline` DATETIME(3) NULL,
    `reviewOpensAt` DATETIME(3) NULL,
    `reviewDeadline` DATETIME(3) NULL,
    `appealDeadline` DATETIME(3) NULL,
    `resultsAnnouncedAt` DATETIME(3) NULL,
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `seriesId` INTEGER NULL,
    `edition` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` INTEGER NULL,
    `mergedIntoId` INTEGER NULL,
    `mergedWikiCode` VARCHAR(191) NULL,
    `resultsPublishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contest_slug_key`(`slug`),
    INDEX `Contest_status_visibility_idx`(`status`, `visibility`),
    INDEX `Contest_primaryWiki_idx`(`primaryWiki`),
    INDEX `Contest_deletedAt_idx`(`deletedAt`),
    UNIQUE INDEX `Contest_seriesId_edition_key`(`seriesId`, `edition`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventSeries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL DEFAULT '',
    `isDemo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EventSeries_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContestWiki` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `wiki` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `overrides` TEXT NOT NULL DEFAULT '{}',
    `requestedById` INTEGER NULL,
    `fountainCode` VARCHAR(191) NOT NULL DEFAULT '',
    `fountainSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContestWiki_contestId_wiki_key`(`contestId`, `wiki`),
    UNIQUE INDEX `ContestWiki_contestId_code_key`(`contestId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContestSettings` (
    `contestId` INTEGER NOT NULL,
    `juryReviewEnabled` BOOLEAN NOT NULL DEFAULT true,
    `appealsEnabled` BOOLEAN NOT NULL DEFAULT false,
    `registrationEnabled` BOOLEAN NOT NULL DEFAULT true,
    `massSubmissionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoValidationEnabled` BOOLEAN NOT NULL DEFAULT true,
    `contributionDiscoveryEnabled` BOOLEAN NOT NULL DEFAULT false,
    `badgesEnabled` BOOLEAN NOT NULL DEFAULT false,
    `wordCountEnabled` BOOLEAN NOT NULL DEFAULT false,
    `publicStatisticsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `participantNotificationsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `registrationRequired` BOOLEAN NOT NULL DEFAULT false,
    `participationMode` VARCHAR(191) NOT NULL DEFAULT 'individual',
    `minAccountAgeDays` INTEGER NOT NULL DEFAULT 0,
    `minEditCount` INTEGER NOT NULL DEFAULT 0,
    `participantLimit` INTEGER NULL,
    `allowJuryParticipation` BOOLEAN NOT NULL DEFAULT false,
    `allowOrganizerParticipation` BOOLEAN NOT NULL DEFAULT false,
    `anonymousParticipants` BOOLEAN NOT NULL DEFAULT false,
    `eligibleNamespaces` TEXT NOT NULL DEFAULT '[]',
    `typeConfig` TEXT NOT NULL DEFAULT '{}',
    `trackHashtags` TEXT NOT NULL DEFAULT '[]',
    `trackCategories` TEXT NOT NULL DEFAULT '[]',
    `marks` TEXT NOT NULL DEFAULT '[]',
    `requiredReviews` INTEGER NOT NULL DEFAULT 1,
    `reviewAssignment` VARCHAR(191) NOT NULL DEFAULT 'open',
    `trackedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`contestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContestMembership` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `wiki` VARCHAR(191) NOT NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedById` INTEGER NULL,

    INDEX `ContestMembership_userId_idx`(`userId`),
    UNIQUE INDEX `ContestMembership_contestId_userId_role_wiki_key`(`contestId`, `userId`, `role`, `wiki`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContestPermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `permission` VARCHAR(191) NOT NULL,
    `allowed` BOOLEAN NOT NULL,

    UNIQUE INDEX `ContestPermission_contestId_userId_permission_key`(`contestId`, `userId`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Submission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `participantId` INTEGER NOT NULL,
    `submittedById` INTEGER NOT NULL,
    `wiki` VARCHAR(191) NOT NULL,
    `title` VARCHAR(1000) NOT NULL,
    `url` TEXT NOT NULL,
    `pageKey` VARCHAR(191) NOT NULL,
    `entryType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `metadata` TEXT NOT NULL DEFAULT '{}',
    `validation` TEXT NOT NULL DEFAULT '{}',
    `checkedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `score` DOUBLE NULL,
    `wordCount` INTEGER NULL,

    INDEX `Submission_contestId_pageKey_idx`(`contestId`, `pageKey`),
    INDEX `Submission_contestId_status_idx`(`contestId`, `status`),
    INDEX `Submission_contestId_participantId_idx`(`contestId`, `participantId`),
    INDEX `Submission_contestId_submittedAt_idx`(`contestId`, `submittedAt`),
    INDEX `Submission_contestId_wordCount_idx`(`contestId`, `wordCount`),
    INDEX `Submission_participantId_idx`(`participantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `submissionId` INTEGER NOT NULL,
    `actorId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `previousValue` VARCHAR(1000) NULL,
    `newValue` VARCHAR(1000) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SubmissionHistory_submissionId_idx`(`submissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WikiSite` (
    `dbname` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `family` VARCHAR(191) NOT NULL,
    `sitename` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `localName` VARCHAR(191) NOT NULL DEFAULT '',
    `lang` VARCHAR(191) NULL,
    `closed` BOOLEAN NOT NULL DEFAULT false,
    `private` BOOLEAN NOT NULL DEFAULT false,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WikiSite_lang_idx`(`lang`),
    PRIMARY KEY (`dbname`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Language` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `localName` VARCHAR(191) NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WikiNamespace` (
    `wiki` VARCHAR(191) NOT NULL,
    `id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `canonical` VARCHAR(191) NULL,
    `content` BOOLEAN NOT NULL DEFAULT false,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`wiki`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `contestId` INTEGER NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_contestId_idx`(`contestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventBlock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `reason` TEXT NOT NULL DEFAULT '',
    `blockedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `liftedAt` DATETIME(3) NULL,

    INDEX `EventBlock_contestId_userId_idx`(`contestId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `wiki` VARCHAR(191) NOT NULL DEFAULT '',
    `title` VARCHAR(1000) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'planned',
    `mode` VARCHAR(191) NOT NULL DEFAULT 'offline',
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `location` TEXT NOT NULL DEFAULT '',
    `meetingUrl` TEXT NOT NULL DEFAULT '',
    `capacity` INTEGER NULL,
    `agenda` TEXT NOT NULL DEFAULT '',
    `report` TEXT NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventSession_contestId_startsAt_idx`(`contestId`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionAttendance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'registered',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `checkedInAt` DATETIME(3) NULL,

    UNIQUE INDEX `SessionAttendance_sessionId_userId_key`(`sessionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contribution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `wiki` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL DEFAULT '',
    `userId` INTEGER NULL,
    `pageTitle` VARCHAR(1000) NOT NULL,
    `ns` INTEGER NOT NULL DEFAULT 0,
    `revId` INTEGER NULL,
    `isNew` BOOLEAN NOT NULL DEFAULT false,
    `sizeDiff` INTEGER NOT NULL DEFAULT 0,
    `comment` TEXT NOT NULL DEFAULT '',
    `timestamp` DATETIME(3) NOT NULL,
    `foundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Contribution_contestId_wiki_idx`(`contestId`, `wiki`),
    INDEX `Contribution_contestId_username_idx`(`contestId`, `username`),
    UNIQUE INDEX `Contribution_contestId_key_key`(`contestId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `sid` VARCHAR(191) NOT NULL,
    `data` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`sid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Review` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `submissionId` INTEGER NOT NULL,
    `jurorId` INTEGER NOT NULL,
    `decision` VARCHAR(191) NOT NULL,
    `marks` TEXT NOT NULL DEFAULT '{}',
    `points` DOUBLE NOT NULL DEFAULT 0,
    `comment` TEXT NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Review_contestId_jurorId_idx`(`contestId`, `jurorId`),
    UNIQUE INDEX `Review_submissionId_jurorId_key`(`submissionId`, `jurorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Appeal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `submissionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `response` TEXT NOT NULL DEFAULT '',
    `resolvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `Appeal_contestId_status_idx`(`contestId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReviewAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `submissionId` INTEGER NOT NULL,
    `jurorId` INTEGER NOT NULL,
    `assignedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReviewAssignment_contestId_jurorId_idx`(`contestId`, `jurorId`),
    UNIQUE INDEX `ReviewAssignment_submissionId_jurorId_key`(`submissionId`, `jurorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermissionChange` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `permission` VARCHAR(191) NOT NULL,
    `allowed` BOOLEAN NOT NULL,
    `changedById` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RolePermissionChange_kind_role_permission_key`(`kind`, `role`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserGlobalRole` ADD CONSTRAINT `UserGlobalRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserGlobalRole` ADD CONSTRAINT `UserGlobalRole_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserWikiRole` ADD CONSTRAINT `UserWikiRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestWiki` ADD CONSTRAINT `ContestWiki_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestSettings` ADD CONSTRAINT `ContestSettings_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestMembership` ADD CONSTRAINT `ContestMembership_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestMembership` ADD CONSTRAINT `ContestMembership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestMembership` ADD CONSTRAINT `ContestMembership_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestPermission` ADD CONSTRAINT `ContestPermission_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContestPermission` ADD CONSTRAINT `ContestPermission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_participantId_fkey` FOREIGN KEY (`participantId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionHistory` ADD CONSTRAINT `SubmissionHistory_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionHistory` ADD CONSTRAINT `SubmissionHistory_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WikiNamespace` ADD CONSTRAINT `WikiNamespace_wiki_fkey` FOREIGN KEY (`wiki`) REFERENCES `WikiSite`(`dbname`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventBlock` ADD CONSTRAINT `EventBlock_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventBlock` ADD CONSTRAINT `EventBlock_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventBlock` ADD CONSTRAINT `EventBlock_blockedById_fkey` FOREIGN KEY (`blockedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventSession` ADD CONSTRAINT `EventSession_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionAttendance` ADD CONSTRAINT `SessionAttendance_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `EventSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionAttendance` ADD CONSTRAINT `SessionAttendance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Review` ADD CONSTRAINT `Review_jurorId_fkey` FOREIGN KEY (`jurorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appeal` ADD CONSTRAINT `Appeal_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appeal` ADD CONSTRAINT `Appeal_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appeal` ADD CONSTRAINT `Appeal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Appeal` ADD CONSTRAINT `Appeal_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAssignment` ADD CONSTRAINT `ReviewAssignment_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAssignment` ADD CONSTRAINT `ReviewAssignment_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReviewAssignment` ADD CONSTRAINT `ReviewAssignment_jurorId_fkey` FOREIGN KEY (`jurorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
