-- Series and edition details, ordering and featuring; an event has at most one parent.
ALTER TABLE `EventSeries`
  ADD COLUMN `shortDescription` VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN `logoUrl` TEXT NULL,
  ADD COLUMN `bannerUrl` TEXT NULL,
  ADD COLUMN `defaultLanguage` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `supportedLanguages` TEXT NOT NULL DEFAULT ('[]'),
  ADD COLUMN `communities` TEXT NOT NULL DEFAULT (''),
  ADD COLUMN `externalLinks` TEXT NOT NULL DEFAULT ('[]'),
  ADD COLUMN `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
  ADD COLUMN `createdById` INTEGER NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `Edition`
  ADD COLUMN `identifier` VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN `cycleType` VARCHAR(191) NULL,
  ADD COLUMN `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `featured` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `createdById` INTEGER NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;
-- Existing editions are named as their address was (2026).
UPDATE `Edition` SET `identifier` = `slug`;
ALTER TABLE `Contest`
  ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `featured` BOOLEAN NOT NULL DEFAULT false;
-- An event is standalone, directly under a series, or under an edition: never both.
UPDATE `Contest` SET `seriesId` = NULL WHERE `seriesId` IS NOT NULL AND `editionId` IS NOT NULL;
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_one_parent` CHECK (`seriesId` IS NULL OR `editionId` IS NULL);
