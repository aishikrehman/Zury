// Wikimedia wikis, languages and namespaces, fetched from the APIs and kept in
// the database so forms and validation never rely on hardcoded lists.
const prisma = require('../config/prisma');
const wikiApi = require('./wikiApi');

const SITEMATRIX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAMESPACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MEMO_MS = 5 * 60 * 1000;

let memo = { at: 0, wikis: null, languages: null };

function parseSitematrix(matrix) {
  const sites = [];
  const languages = [];
  for (const [key, entry] of Object.entries(matrix)) {
    if (key === 'count') continue;
    if (key === 'specials') {
      for (const s of entry) {
        sites.push({ dbname: s.dbname, url: s.url, family: s.code, sitename: s.sitename, lang: s.lang || null, closed: Boolean(s.closed), private: Boolean(s.private) });
      }
      continue;
    }
    languages.push({ code: entry.code, name: entry.localname || entry.name, localName: entry.name || null });
    for (const s of entry.site || []) {
      sites.push({ dbname: s.dbname, url: s.url, family: s.code, sitename: s.sitename, lang: entry.code, closed: Boolean(s.closed), private: Boolean(s.private) });
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
  if (newest && Date.now() - newest.fetchedAt < SITEMATRIX_MAX_AGE_MS) return null;
  return syncSitematrix();
}

async function loadMemo() {
  if (memo.wikis && Date.now() - memo.at < MEMO_MS) return memo;
  const [wikis, languages] = await Promise.all([
    prisma.wikiSite.findMany({ where: { private: false }, select: { dbname: true, closed: true } }),
    prisma.language.findMany({ select: { code: true } }),
  ]);
  memo = {
    at: Date.now(),
    wikis: new Map(wikis.map((w) => [w.dbname, w])),
    languages: new Set(languages.map((l) => l.code)),
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

function searchWikis(q, take = 20) {
  const term = String(q || '').trim().toLowerCase();
  return prisma.wikiSite.findMany({
    where: {
      private: false,
      closed: false,
      ...(term && { OR: [{ dbname: { contains: term } }, { url: { contains: term } }, { sitename: { contains: term } }, { lang: term }] }),
    },
    orderBy: [{ dbname: 'asc' }],
    take,
    select: { dbname: true, url: true, sitename: true, lang: true },
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

module.exports = { parseSitematrix, syncSitematrix, ensureFresh, validators, searchWikis, searchLanguages, namespacesFor };
