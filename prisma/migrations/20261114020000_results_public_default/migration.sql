-- Results are public by default; organizers can still hide them.
ALTER TABLE `Contest` MODIFY `resultsPublishedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);
UPDATE `Contest` SET `resultsPublishedAt` = CURRENT_TIMESTAMP(3) WHERE `resultsPublishedAt` IS NULL;
