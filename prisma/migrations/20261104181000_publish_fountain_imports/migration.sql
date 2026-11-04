-- Events imported from Fountain were left as drafts: publish them (the status sweep
-- then sets upcoming/active/completed from the dates) and leave reviewing to Fountain.
UPDATE `ContestSettings` s JOIN `Contest` c ON c.`id` = s.`contestId`
SET s.`juryReviewEnabled` = false
WHERE c.`deletedAt` IS NULL AND c.`id` IN (SELECT `contestId` FROM `AuditLog` WHERE `action` = 'fountain.imported');
UPDATE `Contest` SET `status` = 'published', `statusMode` = 'auto'
WHERE `status` = 'draft' AND `deletedAt` IS NULL AND `startDate` IS NOT NULL AND `endDate` IS NOT NULL
  AND `id` IN (SELECT `contestId` FROM `AuditLog` WHERE `action` = 'fountain.imported');
