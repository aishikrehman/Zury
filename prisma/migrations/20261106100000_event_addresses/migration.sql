-- Stage 2 of the Series / Edition / Event / Local Event structure: every event gets its
-- address from its actual parent, names are unique per parent, and an event has at most one
-- parent (a series directly, or an edition). No redirects from the old addresses.

ALTER TABLE `Contest` DROP FOREIGN KEY `Contest_editionId_fkey`;
ALTER TABLE `Contest` DROP FOREIGN KEY `Contest_seriesId_fkey`;
ALTER TABLE `Contest` ADD COLUMN `path` VARCHAR(255) NULL;

-- An edition's event is named by its type (/wam/2026/writing); its series comes from the edition.
UPDATE `Contest` SET `slug` = `type` WHERE `editionId` IS NOT NULL AND `deletedAt` IS NULL;
UPDATE `Contest` SET `seriesId` = NULL WHERE `editionId` IS NOT NULL;

UPDATE `Contest` c JOIN `Edition` e ON e.`id` = c.`editionId` JOIN `EventSeries` s ON s.`id` = e.`seriesId`
SET c.`path` = CONCAT('/', s.`slug`, '/', e.`slug`, '/', c.`slug`)
WHERE c.`deletedAt` IS NULL;
UPDATE `Contest` c JOIN `EventSeries` s ON s.`id` = c.`seriesId`
SET c.`path` = CONCAT('/', s.`slug`, '/', c.`slug`)
WHERE c.`editionId` IS NULL AND c.`deletedAt` IS NULL;
UPDATE `Contest` SET `path` = CONCAT('/events/', `slug`)
WHERE `seriesId` IS NULL AND `editionId` IS NULL AND `deletedAt` IS NULL;

-- Direct series events take their name under the series, beside its editions.
INSERT INTO `SeriesSlug` (`seriesId`, `slug`, `editionId`, `contestId`)
SELECT `seriesId`, `slug`, NULL, `id` FROM `Contest` WHERE `seriesId` IS NOT NULL AND `deletedAt` IS NULL;

DROP INDEX `Contest_seriesId_edition_key` ON `Contest`;
DROP INDEX `Contest_slug_key` ON `Contest`;
ALTER TABLE `Contest` DROP COLUMN `edition`;

CREATE UNIQUE INDEX `Contest_path_key` ON `Contest`(`path`);
CREATE INDEX `Contest_seriesId_idx` ON `Contest`(`seriesId`);
CREATE INDEX `Contest_slug_idx` ON `Contest`(`slug`);

ALTER TABLE `Contest` ADD CONSTRAINT `Contest_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `Edition`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- At most one parent.
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_one_parent` CHECK (`seriesId` IS NULL OR `editionId` IS NULL);
