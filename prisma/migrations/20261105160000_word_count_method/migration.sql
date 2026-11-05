-- How each event counts words: auto, ztools or plain.
ALTER TABLE `ContestSettings` ADD COLUMN `wordCountMethod` VARCHAR(191) NOT NULL DEFAULT 'auto';
