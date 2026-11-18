CREATE TABLE `ChatMessage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `channel` VARCHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `hiddenAt` DATETIME(3) NULL,
  `hiddenById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ChatMessage_channel_id_idx`(`channel`, `id`),
  INDEX `ChatMessage_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ChatRead` (
  `userId` INTEGER NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `lastId` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`userId`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
