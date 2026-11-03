// Wikimedia wikis, languages and namespaces, fetched from the APIs and kept in
// the database so forms and validation never rely on hardcoded lists.
const prisma = require('../config/prisma');
const wikiApi = require('./wikiApi');

const SITEMATRIX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAMESPACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MEMO_MS = 5 * 60 * 1000;

let memo = { at: 0, wikis: null, languages: null };

// English names of the project families, for names like "Bangla Wikisource".
const FAMILY_NAMES = {
  wiki: 'Wikipedia', wiktionary: 'Wiktionary', wikibooks: 'Wikibooks', wikinews: 'Wikinews', wikiquote: 'Wikiquote',
  wikisource: 'Wikisource', wikiversity: 'Wikiversity', wikivoyage: 'Wikivoyage', wikimedia: 'Wikimedia',
};

// Special wikis whose sitematrix name is just "Wikipedia".
const SPECIAL_NAMES = {
  wikidatawiki: 'Wikidata', testwikidatawiki: 'Test Wikidata', labswiki: 'Wikitech', testwiki: 'Test Wikipedia',
  test2wiki: 'Test2 Wikipedia', nostalgiawiki: 'Nostalgia Wikipedia', wikimaniawiki: 'Wikimania',
};

// English name for a special wiki: known names, else the site name when it's in
// Latin script and not generic, else "Wikimedia <host>" (e.g. "Wikimedia BD").
function specialName(s) {
  if (SPECIAL_NAMES[s.dbname]) return SPECIAL_NAMES[s.dbname];
  const latin = /^[\p{Script=Latin}\p{N}\p{P}\s]+$/u.test(s.sitename);
  if (latin && !['Wikimedia', 'Wikipedia'].includes(s.sitename)) return s.sitename;
  const host = new URL(s.url).hostname.split('.')[0];
  return `Wikimedia ${host.length <= 3 ? host.toUpperCase() : host.charAt(0).toUpperCase() + host.slice(1)}`;
}

// "বাংলা" + "উইকিপিডিয়া" → "বাংলা উইকিপিডিয়া"; a site name that already says the language stays as it is.
const joinName = (lang, site) => (!lang ? site : site.toLowerCase().includes(lang.toLowerCase()) ? site : `${lang} ${site}`);

function parseSitematrix(matrix) {
  const sites = [];
  const languages = [];
  for (const [key, entry] of Object.entries(matrix)) {
    if (key === 'count') continue;
    if (key === 'specials') {
      for (const s of entry) {
        sites.push({ dbname: s.dbname, url: s.url, family: s.code, sitename: s.sitename, name: specialName(s), localName: SPECIAL_NAMES[s.dbname] ? '' : s.sitename, lang: s.lang || null, closed: Boolean(s.closed), private: Boolean(s.private) });
      }
      continue;
    }
    // In the sitematrix "localname" is the English name and "name" is the language's own.
    const english = entry.localname || entry.name;
    languages.push({ code: entry.code, name: english, localName: entry.name || null });
    for (const s of entry.site || []) {
      sites.push({
        dbname: s.dbname,
        url: s.url,
        family: s.code,
        sitename: s.sitename,
        name: `${english} ${FAMILY_NAMES[s.code] || s.sitename}`,
        localName: joinName(entry.name, s.sitename),
        lang: entry.code,
        closed: Boolean(s.closed),
        private: Boolean(s.private),
      });
    }
  }
  return { sites, languages };
}

async function syncSitematrix() {
  const data = await wikiApi.get('metawiki', {
    action: 'sitematrix',
    smsiteprop: 'dbname|url|sitename|code',
    smlangprop: 'code|name|localname|site',
  });
  const { sites, languages } = parseSitematrix(data.sitematrix || {});
  if (sites.length < 100) throw new Error(`sitematrix returned only ${sites.length} wikis`);
  const now = new Date();
  await prisma.$transaction([
    ...sites.map((s) => prisma.wikiSite.upsert({ where: { dbname: s.dbname }, update: { ...s, fetchedAt: now }, create: { ...s, fetchedAt: now } })),
    ...languages.map((l) => prisma.language.upsert({ where: { code: l.code }, update: { ...l, fetchedAt: now }, create: { ...l, fetchedAt: now } })),
  ]);
  memo = { at: 0, wikis: null, languages: null };
  return { wikis: sites.length, languages: languages.length };
}

// Refreshes in the background when the catalog is missing or stale.
async function ensureFresh() {
  const newest = await prisma.wikiSite.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } });
  // Rows from before names were stored have an empty name: fetch again.
  const unnamed = await prisma.wikiSite.count({ where: { name: '' } });
  if (newest && !unnamed && Date.now() - newest.fetchedAt < SITEMATRIX_MAX_AGE_MS) return null;
  return syncSitematrix();
}

async function loadMemo() {
  if (memo.wikis && Date.now() - memo.at < MEMO_MS) return memo;
  const [wikis, languages] = await Promise.all([
    prisma.wikiSite.findMany({ where: { private: false }, select: { dbname: true, closed: true, name: true, localName: true } }),
    prisma.language.findMany({ select: { code: true, name: true, localName: true } }),
  ]);
  memo = {
    at: Date.now(),
    wikis: new Map(wikis.map((w) => [w.dbname, w])),
    languages: new Set(languages.map((l) => l.code)),
    languageNames: new Map(languages.map((l) => [l.code, l])),
  };
  return memo;
}

// { known(dbname), open(dbname), language(code), empty } for synchronous form validation.
async function validators() {
  const m = await loadMemo();
  // Before the first sync (e.g. offline), fall back to format checks only.
  const empty = m.wikis.size === 0;
  return {
    empty,
    known: (db) => empty || m.wikis.has(db),
    open: (db) => empty || (m.wikis.has(db) && !m.wikis.get(db).closed),
    language: (code) => m.languages.size === 0 || m.languages.has(code) || m.languages.has(code.split('-')[0]),
  };
}

/**
 * Display names for views: wiki(dbname) and language(code) return
 * { name, localName } (English and the language's own), falling back to the code.
 */
async function names() {
  const m = await loadMemo();
  return {
    wiki: (db) => {
      const w = m.wikis.get(db);
      return { name: w?.name || db, localName: w?.localName && !w.name.includes(w.localName) ? w.localName : '' };
    },
    language: (code) => {
      const l = m.languageNames.get(code);
      return { name: l?.name || code, localName: l?.localName && l.localName !== l.name ? l.localName : '' };
    },
  };
}

// Projects to choose from first: the language families (Wikipedia, Wiktionary…)
// and "special" for single wikis such as Commons, Wikidata and Meta-Wiki.
// Language projects; everything else (Commons, Wikidata, chapters…) is "special".
const LANGUAGE_FAMILIES = Object.keys(FAMILY_NAMES).filter((f) => f !== 'wikimedia');

async function projects() {
  const rows = await prisma.wikiSite.groupBy({ by: ['family'], where: { private: false, closed: false }, _count: { _all: true } });
  const special = rows.filter((r) => !LANGUAGE_FAMILIES.includes(r.family)).reduce((n, r) => n + r._count._all, 0);
  const order = LANGUAGE_FAMILIES;
  return [
    ...rows
      .filter((r) => LANGUAGE_FAMILIES.includes(r.family))
      .sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family))
      .map((r) => ({ value: r.family, text: FAMILY_NAMES[r.family], count: r._count._all })),
    ...(special ? [{ value: 'special', text: 'Commons, Wikidata and other wikis', count: special }] : []),
  ];
}

// Which project a wiki belongs to ("special" for single wikis).
async function projectOf(dbname) {
  const w = await prisma.wikiSite.findUnique({ where: { dbname }, select: { family: true } });
  if (!w) return null;
  return LANGUAGE_FAMILIES.includes(w.family) ? w.family : 'special';
}

// family: limit to one project; "special" means wikis without a language.
function searchWikis(q, take = 20, { family } = {}) {
  const term = String(q || '').trim().toLowerCase();
  const byFamily = !family ? {} : family === 'special' ? { family: { notIn: LANGUAGE_FAMILIES } } : { family };
  return prisma.wikiSite.findMany({
    where: {
      private: false,
      closed: false,
      ...byFamily,
      ...(term && {
        OR: [
          { dbname: { contains: term } }, { url: { contains: term } }, { sitename: { contains: String(q).trim() } },
          { name: { contains: String(q).trim() } }, { localName: { contains: String(q).trim() } }, { lang: term },
        ],
      }),
    },
    orderBy: family && family !== 'special' ? [{ name: 'asc' }] : [{ dbname: 'asc' }],
    take,
    select: { dbname: true, url: true, sitename: true, name: true, localName: true, lang: true, family: true },
  });
}

function searchLanguages(q, take = 25) {
  const term = String(q || '').trim();
  return prisma.language.findMany({
    where: term ? { OR: [{ code: { startsWith: term.toLowerCase() } }, { name: { contains: term } }, { localName: { contains: term } }] } : {},
    orderBy: { code: 'asc' },
    take,
  });
}

// Namespaces of a wiki, cached in the database.
async function namespacesFor(dbname) {
  const site = await prisma.wikiSite.findUnique({ where: { dbname }, include: { namespaces: { orderBy: { id: 'asc' } } } });
  if (!site || site.private) return [];
  const fresh = site.namespaces.length && Date.now() - site.namespaces[0].fetchedAt < NAMESPACE_MAX_AGE_MS;
  if (fresh) return site.namespaces;

  const data = await wikiApi.get(dbname, { action: 'query', meta: 'siteinfo', siprop: 'namespaces' });
  const rows = Object.values(data.query?.namespaces || {})
    .filter((n) => Number.isInteger(n.id) && n.id >= 0)
    .map((n) => ({ wiki: dbname, id: n.id, name: n.name || '(Main)', canonical: n.canonical || null, content: Boolean(n.content) }));
  const now = new Date();
  await prisma.$transaction([
    prisma.wikiNamespace.deleteMany({ where: { wiki: dbname } }),
    prisma.wikiNamespace.createMany({ data: rows.map((r) => ({ ...r, fetchedAt: now })) }),
  ]);
  return rows.sort((a, b) => a.id - b.id);
}

module.exports = { FAMILY_NAMES, names, projects, projectOf, parseSitematrix, syncSitematrix, ensureFresh, validators, searchWikis, searchLanguages, namespacesFor };
