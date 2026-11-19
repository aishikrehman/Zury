ALTER TABLE `User` ADD COLUMN `firstLoginAt` DATETIME(3) NULL;
-- Earlier accounts: the account's creation, for those who have logged in.
UPDATE `User` SET `firstLoginAt` = `createdAt` WHERE `lastLoginAt` IS NOT NULL;
