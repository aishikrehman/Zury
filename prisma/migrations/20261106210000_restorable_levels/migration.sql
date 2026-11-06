-- Deleted series and editions free their address and keep it here for a restore.
ALTER TABLE `EventSeries` ADD COLUMN `originalSlug` VARCHAR(191) NULL;
ALTER TABLE `Edition` ADD COLUMN `originalSlug` VARCHAR(191) NULL;
