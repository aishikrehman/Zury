-- AlterTable
ALTER TABLE `ContestSettings` ADD COLUMN `assignPerJuror` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `bulkReviewEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `juryStatsEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `rankBy` VARCHAR(191) NOT NULL DEFAULT 'articles',
    ADD COLUMN `reviewMethod` VARCHAR(191) NOT NULL DEFAULT 'yesno',
    ADD COLUMN `reviewers` TEXT NOT NULL DEFAULT '["jury"]',
    ADD COLUMN `scoreMax` DOUBLE NULL DEFAULT 10,
    ADD COLUMN `scoreMin` DOUBLE NULL DEFAULT 0,
    ADD COLUMN `selfReview` BOOLEAN NOT NULL DEFAULT false;


-- Today's events keep how they work: ranked by words when they counted words, by points when
-- they had marks, else by articles; marks events keep their marks, the others accept or reject.
UPDATE `ContestSettings` SET `rankBy` = CASE WHEN `wordCountEnabled` THEN 'words' WHEN `marks` <> '[]' THEN 'points' ELSE 'articles' END;
UPDATE `ContestSettings` SET `reviewMethod` = 'marks' WHERE `marks` <> '[]';
