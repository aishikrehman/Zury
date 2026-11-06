-- Earlier addresses of events, so old links lead to where the event is now.
CREATE TABLE `OldPath` (
  `path` VARCHAR(255) NOT NULL,
  `contestId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `OldPath_contestId_idx`(`contestId`),
  PRIMARY KEY (`path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `OldPath` ADD CONSTRAINT `OldPath_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `Contest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Edition events that moved to /<series>/<edition>/<code>: the edition's address is now the
-- edition's own page, so it is not kept as an old address.
