-- How reviews decide an entry, ties, and secret ballots.
ALTER TABLE `ContestSettings` ADD COLUMN `decisionRule` VARCHAR(191) NOT NULL DEFAULT 'majority',
  ADD COLUMN `passScore` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `tieBreak` VARCHAR(191) NOT NULL DEFAULT 'reject',
  ADD COLUMN `secretBallot` BOOLEAN NOT NULL DEFAULT false;
