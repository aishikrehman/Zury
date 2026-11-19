CREATE TABLE `Tracker` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `level` VARCHAR(10) NOT NULL,
  `levelId` INTEGER NOT NULL,
  `kind` VARCHAR(10) NOT NULL,
  `code` VARCHAR(300) NOT NULL,
  `category` VARCHAR(255) NOT NULL DEFAULT '',
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `Tracker_level_levelId_idx`(`level`, `levelId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
