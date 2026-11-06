-- An edition holds one event per wiki, at /<series>/<edition>/<wiki code>. Events that sat at the
-- edition's own address take their primary wiki's code (from their wikis, else from the dbname).
UPDATE `Contest` c
  JOIN `Edition` e ON e.id = c.editionId
  JOIN `EventSeries` s ON s.id = e.seriesId
  LEFT JOIN `ContestWiki` w ON w.contestId = c.id AND w.wiki = c.primaryWiki
SET c.slug = COALESCE(w.code, REPLACE(c.primaryWiki, 'wiki', '')),
    c.path = CONCAT('/', s.slug, '/', e.slug, '/', COALESCE(w.code, REPLACE(c.primaryWiki, 'wiki', '')))
WHERE c.deletedAt IS NULL AND c.path = CONCAT('/', s.slug, '/', e.slug);
