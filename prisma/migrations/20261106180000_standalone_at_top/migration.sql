-- Standalone events live at the top (/<name>) instead of /events/<name>. Series and standalone
-- events share those names; an event whose name is taken by a series or by one of Zury's own
-- pages gets -<id> added.
-- (the address is set first: MariaDB applies SET from left to right)
UPDATE `Contest` SET `path` = CONCAT('/', LEFT(CONCAT(`slug`, '-', `id`), 190)), `slug` = LEFT(CONCAT(`slug`, '-', `id`), 190)
WHERE `path` LIKE '/events/%' AND (`slug` IN ('events', 'contest', 'admin', 'api', 'users', 'dashboard', 'settings', 'submissions', 'login', 'logout', 'auth', 'layout', 'preferences', 'review', 'vendor', 'css', 'js', 'images', 'about', 'favicon.ico', 'series', 'robots.txt', 'sitemap.xml', 'icons', 'notifications', 'photo', 'writing', 'data', 'editathon', 'workshop', 'training', 'photowalk', 'proofread', 'glam', 'digitization', 'active', 'upcoming', 'completed', 'create', 'import') OR `slug` IN (SELECT `slug` FROM `EventSeries`));
UPDATE `Contest` SET `path` = CONCAT('/', `slug`) WHERE `path` LIKE '/events/%';
