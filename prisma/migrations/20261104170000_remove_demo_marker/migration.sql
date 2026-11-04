-- The demo marker is no longer used.
ALTER TABLE `User` DROP COLUMN `isDemo`;
ALTER TABLE `Contest` DROP COLUMN `isDemo`;
ALTER TABLE `EventSeries` DROP COLUMN `isDemo`;
