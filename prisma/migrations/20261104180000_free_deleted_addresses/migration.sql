-- Deleted events give up their address (/<slug> and /<series>/<edition>).
UPDATE `Contest` SET `slug` = LEFT(CONCAT('deleted-', `id`, '-', `slug`), 190), `edition` = NULL WHERE `deletedAt` IS NOT NULL AND `slug` NOT LIKE 'deleted-%';
