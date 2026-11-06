-- Series events' addresses begin with their type: /photo/wlm/2026, /writing/wam/2026, /photo/wlm/<slug>.
-- Standalone events (/events/<slug>) stay as they are.
UPDATE `Contest` SET `path` = CONCAT('/', `type`, `path`)
WHERE `path` IS NOT NULL AND `path` NOT LIKE '/events/%' AND (`seriesId` IS NOT NULL OR `editionId` IS NOT NULL);
