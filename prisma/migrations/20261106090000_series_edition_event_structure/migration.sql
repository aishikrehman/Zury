-- Stage 1 of the Series / Edition / Event / Local Event structure: the new tables, and the
-- editions of today's series moved into Edition records. Old columns stay until stage 2.

-- AlterTable
ALTER TABLE `Contest` ADD COLUMN `editionId` INTEGER NULL;
-- AlterTable
ALTER TABLE `EventSeries` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
-- AlterTable
ALTER TABLE `Submission` ADD COLUMN `localEventId` INTEGER NULL;
-- CreateTable
CREATE TABLE `Edition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seriesId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(1000) NOT NULL,
    `year` INTEGER NULL,
    `description` TEXT NOT NULL DEFAULT '',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Edition_seriesId_slug_key`(`seriesId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateTable
CREATE TABLE `SeriesSlug` (
    `seriesId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `editionId` INTEGER NULL,
    `contestId` INTEGER NULL,
    UNIQUE INDEX `SeriesSlug_editionId_key`(`editionId`),
    UNIQUE INDEX `SeriesSlug_contestId_key`(`contestId`),
    PRIMARY KEY (`seriesId`, `slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateTable
CREATE TABLE `LocalEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contestId` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `title` VARCHAR(1000) NULL,
    `wiki` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LocalEvent_contestId_slug_key`(`contestId`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CreateIndex
CREATE INDEX `Contest_editionId_idx` ON `Contest`(`editionId`);
-- AddForeignKey
ALTER TABLE `Contest` ADD CONSTRAINT `Contest_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `Edition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `Edition` ADD CONSTRAINT `Edition_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `SeriesSlug` ADD CONSTRAINT `SeriesSlug_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `SeriesSlug` ADD CONSTRAINT `SeriesSlug_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `Edition`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE `SeriesSlug` ADD CONSTRAINT `SeriesSlug_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE `LocalEvent` ADD CONSTRAINT `LocalEvent_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_localEventId_fkey` FOREIGN KEY (`localEventId`) REFERENCES `LocalEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- An entry under a series is an edition or a direct event, never both and never neither.
ALTER TABLE `SeriesSlug` ADD CONSTRAINT `SeriesSlug_one_owner` CHECK ((`editionId` IS NULL) <> (`contestId` IS NULL));

-- Today's editions: each event with a series and an edition name becomes an Edition holding that event.
INSERT INTO `Edition` (`seriesId`, `slug`, `title`, `year`, `description`, `status`, `startDate`, `endDate`, `deletedAt`, `createdAt`, `updatedAt`)
SELECT c.`seriesId`, c.`edition`, c.`title`,
       IF(c.`edition` REGEXP '^[0-9]{4}$', CAST(c.`edition` AS UNSIGNED), NULL),
       '',
       CASE WHEN c.`status` = 'draft' THEN 'draft' WHEN c.`status` IN ('completed', 'archived') THEN c.`status` ELSE 'active' END,
       c.`startDate`, c.`endDate`, c.`deletedAt`, c.`createdAt`, CURRENT_TIMESTAMP(3)
FROM `Contest` c
WHERE c.`seriesId` IS NOT NULL AND c.`edition` IS NOT NULL;

UPDATE `Contest` c JOIN `Edition` e ON e.`seriesId` = c.`seriesId` AND e.`slug` = c.`edition`
SET c.`editionId` = e.`id`;

INSERT INTO `SeriesSlug` (`seriesId`, `slug`, `editionId`, `contestId`)
SELECT `seriesId`, `slug`, `id`, NULL FROM `Edition`;
