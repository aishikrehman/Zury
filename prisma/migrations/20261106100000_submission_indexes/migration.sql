-- Large events (Wikidata, lexemes) can hold 100,000+ entries: index the filters and sorts.
CREATE INDEX "Submission_contestId_participantId_idx" ON "Submission"("contestId", "participantId");
CREATE INDEX "Submission_contestId_submittedAt_idx" ON "Submission"("contestId", "submittedAt");
CREATE INDEX "Submission_contestId_wordCount_idx" ON "Submission"("contestId", "wordCount");
