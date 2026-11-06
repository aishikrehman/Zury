-- Entries from Fountain get the same key as any entry (wiki:pageid; Wikidata keeps wikidata:Q…),
-- so an article imported from Fountain and the same article submitted in Zury count as one.
UPDATE `Submission` SET `pageKey` = CONCAT(`wiki`, ':', `pageKey`) WHERE `pageKey` NOT LIKE '%:%';
