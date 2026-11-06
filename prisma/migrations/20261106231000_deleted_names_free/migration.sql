-- Series and editions deleted before deletion freed their names: they give the names up now
-- (kept in originalSlug for a restore), so a new edition or series can use them.
UPDATE `Edition` SET `originalSlug` = `slug`, `slug` = LEFT(CONCAT('~', `id`, '-', `slug`), 190) WHERE `deletedAt` IS NOT NULL AND `originalSlug` IS NULL;
UPDATE `EventSeries` SET `originalSlug` = `slug`, `slug` = LEFT(CONCAT('~', `id`, '-', `slug`), 190) WHERE `deletedAt` IS NOT NULL AND `originalSlug` IS NULL;
DELETE `SeriesSlug` FROM `SeriesSlug` JOIN `Edition` ON `Edition`.`id` = `SeriesSlug`.`editionId` WHERE `Edition`.`deletedAt` IS NOT NULL;
