const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET ||= 'test';
const { parseEntry, hostToDbname, dbnameToHost, pageUrl } = require('../src/wiki/wikiUrls');
const { checkEntry, submissionWindow, pageKeyFor } = require('../src/services/submissionRules');
const { defaultSettings } = require('../src/services/contestFormService');
const { readTypeConfig } = require('../src/events/eventTypes');
const { countWords } = require('../src/wiki/entryMetadata');

test('hosts and database names map both ways', () => {
  for (const [host, db] of [
    ['bn.wikipedia.org', 'bnwiki'],
    ['en.m.wikipedia.org', 'enwiki'],
    ['commons.wikimedia.org', 'commonswiki'],
    ['www.wikidata.org', 'wikidatawiki'],
    ['bn.wiktionary.org', 'bnwiktionary'],
    ['zh-min-nan.wikipedia.org', 'zh_min_nanwiki'],
  ]) assert.equal(hostToDbname(host), db, host);
  assert.equal(dbnameToHost('zh_min_nanwiki'), 'zh-min-nan.wikipedia.org');
  assert.equal(dbnameToHost('enwikisource'), 'en.wikisource.org');
  assert.equal(dbnameToHost('wikidatawiki'), 'www.wikidata.org');
  assert.equal(hostToDbname('evil.example.org'), null);
  assert.equal(hostToDbname('www.wikipedia.org'), null);
  assert.equal(pageUrl('bnwiki', 'Dhaka City'), 'https://bn.wikipedia.org/wiki/Dhaka_City');
});

test('entries parse from URLs, titles and Wikidata IDs', () => {
  assert.deepEqual(parseEntry('https://bn.wikipedia.org/wiki/%E0%A6%A2%E0%A6%BE%E0%A6%95%E0%A6%BE', 'enwiki'), { wiki: 'bnwiki', title: 'ঢাকা' });
  assert.deepEqual(parseEntry('https://commons.m.wikimedia.org/wiki/File:A_b.jpg', 'x'), { wiki: 'commonswiki', title: 'File:A b.jpg' });
  assert.deepEqual(parseEntry('https://en.wikipedia.org/w/index.php?title=Some_page&oldid=1', 'x'), { wiki: 'enwiki', title: 'Some page' });
  assert.deepEqual(parseEntry('https://en.wikipedia.org/w/index.php?curid=42', 'x'), { wiki: 'enwiki', pageId: 42 });
  assert.deepEqual(parseEntry('https://www.wikidata.org/wiki/q42', 'x'), { wiki: 'wikidatawiki', title: 'Q42' });
  assert.deepEqual(parseEntry('https://www.wikidata.org/wiki/Property:P31', 'x'), { wiki: 'wikidatawiki', title: 'Property:P31' });
  assert.deepEqual(parseEntry('L7', 'bnwiki'), { wiki: 'wikidatawiki', title: 'Lexeme:L7' });
  assert.deepEqual(parseEntry('P31', 'wikidatawiki'), { wiki: 'wikidatawiki', title: 'Property:P31' });
  assert.deepEqual(parseEntry('lalbagh_fort', 'enwiki'), { wiki: 'enwiki', title: 'Lalbagh fort' });
  assert.match(parseEntry('https://example.com/wiki/X', 'enwiki').error, /Wikimedia/);
  assert.match(parseEntry('javascript:alert(1)', 'enwiki').error ?? '', /cannot contain|^$/);
  assert.ok(parseEntry('Bad [title]', 'enwiki').error);
  assert.ok(parseEntry('', 'enwiki').error);
});

test('word counting ignores punctuation and handles Bengali', () => {
  assert.equal(countWords('ঢাকা বাংলাদেশের রাজধানী — এবং বৃহত্তম শহর।'), 6);
  assert.equal(countWords(''), 0);
});

const photoContest = {
  type: 'photo',
  primaryWiki: 'commonswiki',
  additionalWikis: '[]',
  startDate: new Date('2026-09-01T00:00:00Z'),
  endDate: new Date('2026-11-30T00:00:00Z'),
};
const photoSettings = defaultSettings('photo');
const photoConfig = { ...readTypeConfig('photo', '{}'), requiredCategory: 'WLM 2026', maxEntriesPerParticipant: 2 };
const goodFile = {
  exists: true,
  wiki: 'commonswiki',
  pageId: 1,
  ns: 6,
  title: 'File:A.jpg',
  entryType: 'file',
  createdAt: '2026-10-01T00:00:00Z',
  categories: ['WLM_2026'],
  file: { megapixels: 12, mime: 'image/jpeg' },
};

test('photo rules: resolution, category, upload date, limit, duplicates', () => {
  const ok = checkEntry({ meta: goodFile, contest: photoContest, settings: photoSettings, typeConfig: photoConfig });
  assert.deepEqual(ok, { hard: [], rules: [], warnings: [] });

  const bad = checkEntry({
    meta: { ...goodFile, file: { megapixels: 0.5, mime: 'video/webm' }, categories: [], createdAt: '2025-01-01T00:00:00Z', wiki: 'enwiki', ns: 0 },
    contest: photoContest,
    settings: photoSettings,
    typeConfig: photoConfig,
  });
  assert.equal(bad.rules.length, 6, bad.rules.join(' | '));

  assert.match(checkEntry({ meta: goodFile, contest: photoContest, settings: photoSettings, typeConfig: photoConfig, existingKeys: new Set(['commonswiki:1']) }).hard[0], /Already submitted/);
  assert.match(checkEntry({ meta: goodFile, contest: photoContest, settings: photoSettings, typeConfig: photoConfig, entriesByParticipant: 2 }).hard[0], /Limit of 2/);
  assert.match(checkEntry({ meta: { exists: false }, contest: photoContest, settings: photoSettings, typeConfig: photoConfig }).hard[0], /does not exist/);
});

test('writing and data rules', () => {
  const writing = { ...photoContest, type: 'writing', primaryWiki: 'bnwiki' };
  const cfg = readTypeConfig('writing', '{}');
  const article = { exists: true, wiki: 'bnwiki', pageId: 5, ns: 0, entryType: 'article', sizeBytes: 5000, wordCount: 400, createdAt: '2026-10-01T00:00:00Z', categories: [] };
  assert.deepEqual(checkEntry({ meta: article, contest: writing, settings: defaultSettings('writing'), typeConfig: cfg }).rules, []);
  const short = checkEntry({ meta: { ...article, sizeBytes: 10, wordCount: null, createdAt: '2020-01-01T00:00:00Z' }, contest: writing, settings: defaultSettings('writing'), typeConfig: cfg });
  assert.equal(short.rules.length, 2);
  assert.match(short.warnings[0], /Word count/);
  const expansion = checkEntry({ meta: { ...article, createdAt: '2020-01-01T00:00:00Z' }, contest: writing, settings: defaultSettings('writing'), typeConfig: { ...cfg, allowExpansions: true } });
  assert.deepEqual(expansion.rules, []);
  assert.match(expansion.warnings[0], /expanded/);

  const data = { ...photoContest, type: 'data', primaryWiki: 'wikidatawiki' };
  const dcfg = { entityTypes: ['item'], requiredProperties: ['P17', 'P625'], minStatements: 3 };
  const item = { exists: true, wiki: 'wikidatawiki', pageId: 9, ns: 0, entryType: 'item', categories: [], entity: { id: 'Q1', type: 'item', properties: ['P17', 'P625'], statementCount: 4 } };
  assert.deepEqual(checkEntry({ meta: item, contest: data, settings: defaultSettings('data'), typeConfig: dcfg }).rules, []);
  assert.equal(pageKeyFor(item), 'wikidata:Q1');
  const lexeme = checkEntry({ meta: { ...item, ns: 146, entity: { id: 'L1', type: 'lexeme', properties: [], statementCount: 0 } }, contest: data, settings: defaultSettings('data'), typeConfig: dcfg });
  assert.equal(lexeme.rules.length, 4, lexeme.rules.join(' | '));
});

test('submission window follows status and dates', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(submissionWindow({ ...photoContest, status: 'active' }, now).open, true);
  assert.equal(submissionWindow({ ...photoContest, status: 'upcoming' }, now).open, false);
  assert.match(submissionWindow({ ...photoContest, status: 'active', submissionDeadline: new Date('2026-09-15T00:00:00Z') }, now).reason, /deadline/);
  assert.match(submissionWindow({ ...photoContest, status: 'active', submissionOpensAt: new Date('2026-10-15T00:00:00Z') }, now).reason, /not opened/);
});
