-- AlterTable
ALTER TABLE `ContestWiki` ADD COLUMN `type` VARCHAR(40) NULL;


-- A wiki whose project doesn't fit the event's type takes its project's type: Commons photos,
-- Wikidata data, Wikisource proofreading (the event's own type stays for its other wikis).
UPDATE `ContestWiki` w JOIN `Contest` c ON c.`id` = w.`contestId`
SET w.`type` = 'photo'
WHERE w.`wiki` = 'commonswiki' AND c.`type` NOT IN ('photo', 'photowalk', 'glam', 'digitization');
UPDATE `ContestWiki` w JOIN `Contest` c ON c.`id` = w.`contestId`
SET w.`type` = 'data'
WHERE w.`wiki` = 'wikidatawiki' AND c.`type` <> 'data';
UPDATE `ContestWiki` w JOIN `Contest` c ON c.`id` = w.`contestId`
SET w.`type` = 'proofread'
WHERE w.`wiki` LIKE '%wikisource' AND c.`type` NOT IN ('proofread', 'digitization');
