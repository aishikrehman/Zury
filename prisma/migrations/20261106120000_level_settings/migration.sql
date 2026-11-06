-- AlterTable
ALTER TABLE `ContestSettings` ADD COLUMN `followed` TEXT NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE `LevelSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seriesId` INTEGER NULL,
    `editionId` INTEGER NULL,
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'default',
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` INTEGER NULL,

    INDEX `LevelSetting_seriesId_idx`(`seriesId`),
    INDEX `LevelSetting_editionId_idx`(`editionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LevelSetting` ADD CONSTRAINT `LevelSetting_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LevelSetting` ADD CONSTRAINT `LevelSetting_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `Edition`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `LevelSetting` ADD CONSTRAINT `LevelSetting_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- A setting belongs to a series or to an edition, never both or neither.
ALTER TABLE `LevelSetting` ADD CONSTRAINT `LevelSetting_one_level` CHECK ((`seriesId` IS NULL) <> (`editionId` IS NULL));
