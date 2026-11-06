-- Ways to take part, teams and eligible article lists.
ALTER TABLE `ContestSettings` ADD COLUMN `participation` TEXT NOT NULL DEFAULT ('{}'), ADD COLUMN `eligibleTitles` MEDIUMTEXT NOT NULL DEFAULT ('[]');
ALTER TABLE `User` ADD COLUMN `profile` TEXT NOT NULL DEFAULT ('{}');
CREATE TABLE `Team` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contestId` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `Team_contestId_name_key`(`contestId`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `Team` ADD CONSTRAINT `Team_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ContestMembership` ADD COLUMN `details` TEXT NOT NULL DEFAULT ('{}'), ADD COLUMN `teamId` INTEGER NULL;
ALTER TABLE `ContestMembership` ADD CONSTRAINT `ContestMembership_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
