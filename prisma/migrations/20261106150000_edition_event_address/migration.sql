-- An edition's event lives at the edition's own address (/<series>/<edition>): its wikis carry
-- the different projects. Where an older edition holds several events, the first keeps the
-- edition's address and the others stay where they are (/<series>/<edition>/<slug>).
UPDATE `Contest` c
JOIN `Edition` e ON e.`id` = c.`editionId`
JOIN `EventSeries` s ON s.`id` = e.`seriesId`
JOIN (SELECT `editionId`, MIN(`id`) AS `id` FROM `Contest` WHERE `editionId` IS NOT NULL AND `deletedAt` IS NULL GROUP BY `editionId`) f ON f.`id` = c.`id`
SET c.`path` = CONCAT('/', s.`slug`, '/', e.`slug`);
