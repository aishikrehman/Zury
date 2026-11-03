const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/testApp');

let t;
before(async () => {
  t = await startTestApp({ DEMO_MODE: 'false' });
});
after(() => t?.stop());

const SITEMATRIX = {
  count: 3,
  0: {
    code: 'bn',
    name: 'বাংলা',
    localname: 'Bangla',
    site: [
      { url: 'https://bn.wikipedia.org', dbname: 'bnwiki', code: 'wiki', sitename: 'উইকিপিডিয়া' },
      { url: 'https://bn.wikivoyage.org', dbname: 'bnwikivoyage', code: 'wikivoyage', sitename: 'Wikivoyage', closed: true },
    ],
  },
  specials: [
    { url: 'https://commons.wikimedia.org', dbname: 'commonswiki', code: 'commons', sitename: 'Wikimedia Commons', lang: 'commons' },
    { url: 'https://office.wikimedia.org', dbname: 'officewiki', code: 'office', sitename: 'Office', private: true },
  ],
};

test('sitematrix parsing keeps wikis, languages and closed/private flags', () => {
  const { parseSitematrix } = require('../src/wiki/catalogService');
  const { sites, languages } = parseSitematrix(SITEMATRIX);
  assert.deepEqual(languages, [{ code: 'bn', name: 'Bangla', localName: 'বাংলা' }]);
  assert.deepEqual(sites.map((s) => [s.dbname, s.lang, s.closed, s.private]), [
    ['bnwiki', 'bn', false, false],
    ['bnwikivoyage', 'bn', true, false],
    ['commonswiki', 'commons', false, false],
    ['officewiki', null, false, true],
  ]);
});

test('stored catalog drives lookups and validation', async () => {
  const catalog = require('../src/wiki/catalogService');
  const { sites, languages } = catalog.parseSitematrix(SITEMATRIX);
  for (const s of sites) await t.prisma.wikiSite.create({ data: s });
  for (const l of languages) await t.prisma.language.create({ data: l });

  const wikis = await (await fetch(`${t.baseUrl}/api/wikis?q=bn`)).json();
  assert.deepEqual(wikis.map((w) => w.value), ['bnwiki'], 'closed and private wikis are not offered');
  const langs = await (await fetch(`${t.baseUrl}/api/languages?q=Ban`)).json();
  assert.deepEqual(langs.map((l) => l.value), ['bn']);

  const v = await catalog.validators();
  assert.equal(v.known('bnwiki'), true);
  assert.equal(v.known('madeupwiki'), false);
  assert.equal(v.open('bnwikivoyage'), false);
  assert.equal(v.known('officewiki'), false, 'private wikis are not usable');
  assert.equal(v.language('bn'), true);
  assert.equal(v.language('xx'), false);

  const { parse } = require('../src/services/contestFormService');
  const base = { title: 'Catalog test', timezone: 'UTC', language: 'bn', minAccountAgeDays: '0', minEditCount: '0' };
  const ok = parse({ ...base, primaryWiki: 'bnwiki', additionalWikis: ['commonswiki'] }, { type: 'writing', wikiAllowed: () => true, catalog: v });
  assert.deepEqual(ok.errors, {});
  const bad = parse({ ...base, primaryWiki: 'bnwikivoyage', additionalWikis: ['madeupwiki'], language: 'xx' }, { type: 'writing', wikiAllowed: () => true, catalog: v });
  assert.match(bad.errors.primaryWiki, /closed/);
  assert.match(bad.errors.additionalWikis, /madeupwiki/);
  assert.match(bad.errors.language, /Unknown language/);
});

test('user search needs a login', async () => {
  const res = await t.request('/api/users?q=Ex');
  assert.equal(res.status, 302);
});

test('wikis carry English and local names; the picker lists projects, then languages', async () => {
  const { sites } = require('../src/wiki/catalogService').parseSitematrix(SITEMATRIX);
  const bn = sites.find((s) => s.dbname === 'bnwiki');
  assert.equal(bn.name, 'Bangla Wikipedia');
  assert.equal(bn.localName, 'বাংলা উইকিপিডিয়া');
  assert.equal(sites.find((s) => s.dbname === 'commonswiki').name, 'Wikimedia Commons');

  const projects = await (await fetch(`${t.baseUrl}/api/projects`)).json();
  assert.deepEqual(projects.map((p) => p.value), ['wiki', 'special'], 'only projects with open public wikis');
  const wikipedias = await (await fetch(`${t.baseUrl}/api/wikis?project=wiki`)).json();
  assert.deepEqual(wikipedias.map((w) => [w.value, w.text, w.localName]), [['bnwiki', 'Bangla', 'বাংলা']]);
  const specials = await (await fetch(`${t.baseUrl}/api/wikis?project=special`)).json();
  assert.deepEqual(specials.map((w) => w.value), ['commonswiki']);
  assert.deepEqual(await (await fetch(`${t.baseUrl}/api/wikis?db=bnwiki`)).json(), { project: 'wiki' });
  assert.deepEqual(await (await fetch(`${t.baseUrl}/api/wikis?db=commonswiki`)).json(), { project: 'special' });

  const page = await (await fetch(`${t.baseUrl}/events`)).text();
  assert.equal(page.includes('undefined'), false);
});
