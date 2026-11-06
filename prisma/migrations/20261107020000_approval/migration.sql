-- New events, series and editions by people who can't approve them wait for approval.
ALTER TABLE `Contest` ADD COLUMN `approval` VARCHAR(191) NOT NULL DEFAULT 'approved';
ALTER TABLE `EventSeries` ADD COLUMN `approval` VARCHAR(191) NOT NULL DEFAULT 'approved';
ALTER TABLE `Edition` ADD COLUMN `approval` VARCHAR(191) NOT NULL DEFAULT 'approved';
