-- Word counts: an event-level switch, and each entry's count kept as a column.
ALTER TABLE "ContestSettings" ADD COLUMN "wordCountEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN "wordCount" INTEGER;
UPDATE "Submission" SET "wordCount" = CAST(json_extract("metadata", '$.wordCount') AS INTEGER) WHERE json_valid("metadata") AND json_extract("metadata", '$.wordCount') IS NOT NULL;
