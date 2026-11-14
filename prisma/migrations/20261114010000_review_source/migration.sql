-- Where a review was made: "" in Zury, "fountain" or "import" when it came from elsewhere.
ALTER TABLE `Review` ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT '';
