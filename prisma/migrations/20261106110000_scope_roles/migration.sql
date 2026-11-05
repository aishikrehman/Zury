-- CreateTable
CREATE TABLE `ScopeRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `seriesId` INTEGER NULL,
    `editionId` INTEGER NULL,
    `appliesToChildren` BOOLEAN NOT NULL DEFAULT false,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedById` INTEGER NULL,

    INDEX `ScopeRole_userId_idx`(`userId`),
    INDEX `ScopeRole_seriesId_idx`(`seriesId`),
    INDEX `ScopeRole_editionId_idx`(`editionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ScopeRole` ADD CONSTRAINT `ScopeRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScopeRole` ADD CONSTRAINT `ScopeRole_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScopeRole` ADD CONSTRAINT `ScopeRole_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `EventSeries`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ScopeRole` ADD CONSTRAINT `ScopeRole_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `Edition`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- A role belongs to a series or to an edition, never both or neither.
ALTER TABLE `ScopeRole` ADD CONSTRAINT `ScopeRole_one_scope` CHECK ((`seriesId` IS NULL) <> (`editionId` IS NULL));

-- Until now any organizer of a series' event could run the series. Keep that as an explicit
-- series role (this level only; it gives nothing on the series' other events).
INSERT INTO `ScopeRole` (`userId`, `role`, `seriesId`, `appliesToChildren`)
SELECT DISTINCT m.`userId`, 'organizer', COALESCE(c.`seriesId`, e.`seriesId`), false
FROM `ContestMembership` m
JOIN `Contest` c ON c.`id` = m.`contestId`
LEFT JOIN `Edition` e ON e.`id` = c.`editionId`
WHERE m.`role` = 'organizer' AND m.`status` = 'active' AND m.`wiki` = '' AND c.`deletedAt` IS NULL
  AND COALESCE(c.`seriesId`, e.`seriesId`) IS NOT NULL;
