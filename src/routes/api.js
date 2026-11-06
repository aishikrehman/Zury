// JSON lookups used by the searchable pickers in forms.
const express = require('express');
const catalog = require('../wiki/catalogService');
const wikiApi = require('../wiki/wikiApi');
const prisma = require('../config/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const q = (req) => (typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '');

// Is this address free? ?slug=…&series=…&edition=…&exclude=<event id>, or ?kind=series&slug=….
// Answers { free, path, reason, suggestion } for the live check in the event and series forms.
router.get('/api/address', requireAuth, async (req, res, next) => {
  try {
    const editions = require('../services/editionService');
    const { RESERVED } = require('../middleware/permissions');
    const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const slug = String(req.query.slug || '').trim().toLowerCase();
    const bad = !SLUG.test(slug) || slug.length > (req.query.kind === 'series' ? 40 : 80);
    if (req.query.kind === 'series') {
      const taken = !bad && (RESERVED.has(slug) || (await prisma.eventSeries.findUnique({ where: { slug }, select: { id: true } })) || (await prisma.contest.findFirst({ where: { path: `/${slug}` }, select: { id: true } })));
      return res.json({ free: !bad && !taken, path: `/${slug}`, reason: bad ? 'form' : taken ? 'taken' : '' });
    }
    const excludeId = Number(req.query.exclude) || null;
    const parent = { seriesId: null, editionId: null };
    const seriesSlug = String(req.query.series || '').trim().toLowerCase();
    if (seriesSlug) {
      const sr = await prisma.eventSeries.findUnique({ where: { slug: seriesSlug }, select: { id: true } });
      if (sr) {
        const ed = req.query.edition ? await prisma.edition.findUnique({ where: { seriesId_slug: { seriesId: sr.id, slug: String(req.query.edition) } }, select: { id: true } }) : null;
        if (ed) parent.editionId = ed.id;
        else parent.seriesId = sr.id;
      } else {
        // A new series: its name must be free at the top, and anything under it is.
        const taken = RESERVED.has(seriesSlug) || (await prisma.contest.findFirst({ where: { path: `/${seriesSlug}` }, select: { id: true } }));
        return res.json({ free: !taken, path: `/${seriesSlug}/${slug}`, reason: taken ? 'series' : '' });
      }
    }
    if (parent.editionId) {
      // An edition's event is the edition's address.
      const has = await editions.eventOf(parent.editionId, { excludeId });
      return res.json({ free: !has, path: await editions.pathFor(slug, parent, prisma, excludeId), reason: has ? 'edition' : '' });
    }
    if (bad) return res.json({ free: false, reason: 'form' });
    const free = await editions.slugFree(slug, parent, { excludeId });
    let suggestion = '';
    if (!free) for (let i = 2; i < 50 && !suggestion; i++) if (await editions.slugFree(`${slug.slice(0, 76)}-${i}`, parent, { excludeId })) suggestion = `${slug.slice(0, 76)}-${i}`;
    res.json({ free, path: await editions.pathFor(slug, parent, prisma, excludeId), reason: free ? '' : 'taken', suggestion });
  } catch (err) {
    next(err);
  }
});

// "Part of": existing series, with their latest edition so the form can
// suggest the next one and link the previous one.
router.get('/api/series', async (req, res, next) => {
  try {
    const term = q(req).trim();
    const rows = await prisma.eventSeries.findMany({
      orderBy: { title: 'asc' },
      take: 30,
      where: { deletedAt: null, ...(term ? { OR: [{ slug: { contains: term.toLowerCase() } }, { title: { contains: term } }] } : {}) },
      include: { editionRecords: { where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { slug: 'desc' }], take: 30, select: { slug: true, title: true, events: { where: { deletedAt: null }, select: { id: true }, take: 1 } } } },
    });
    res.json(rows.map((r) => ({ value: r.slug, text: r.title, latest: r.editionRecords[0]?.slug || null, editions: r.editionRecords.map((e) => e.slug), editionList: r.editionRecords.map((e) => ({ slug: e.slug, title: e.title, taken: e.events.length > 0 })) })));
  } catch (err) {
    next(err);
  }
});

// Organizing communities: ones used by earlier events, and Wikimedia affiliates
// that have their own wiki (chapters and user groups).
router.get('/api/communities', async (req, res, next) => {
  try {
    const term = q(req).trim();
    const [used, affiliates] = await Promise.all([
      prisma.contest.findMany({
        where: { organizingCommunity: term ? { contains: term } : { not: '' }, deletedAt: null },
        distinct: ['organizingCommunity'],
        select: { organizingCommunity: true },
        take: 30,
      }),
      prisma.wikiSite.findMany({
        where: { dbname: { endsWith: 'wikimedia' }, private: false, closed: false, ...(term && { OR: [{ name: { contains: term } }, { localName: { contains: term } }] }) },
        select: { name: true, localName: true },
        take: 30,
      }),
    ]);
    const names = new Map();
    for (const u of used) names.set(u.organizingCommunity, { value: u.organizingCommunity, text: u.organizingCommunity });
    for (const a of affiliates) {
      if (!names.has(a.name)) names.set(a.name, { value: a.name, text: a.name, localName: a.localName && a.localName !== a.name ? a.localName : '' });
    }
    res.json([...names.values()].sort((x, y) => x.text.localeCompare(y.text)));
  } catch (err) {
    next(err);
  }
});

// Wiki picker, step 1: languages with wikis (and "special" for Commons, Wikidata…).
router.get('/api/wiki-languages', async (req, res, next) => {
  try {
    res.json(await catalog.wikiLanguages());
  } catch (err) {
    next(err);
  }
});

// Step 2: that language's wikis ("Wikisource · উইকিসংকলন").
// ?db=bnwiki answers which language group a wiki is in, for pre-filled forms.
router.get('/api/wiki-languages/:code', async (req, res, next) => {
  try {
    res.json(await catalog.wikisForLanguage(req.params.code.slice(0, 30)));
  } catch (err) {
    next(err);
  }
});

router.get('/api/wiki-of', async (req, res, next) => {
  try {
    res.json({ language: await catalog.languageOf(String(req.query.db || '').slice(0, 64)) });
  } catch (err) {
    next(err);
  }
});

// Projects (Wikipedia, Wiktionary…) with their number of wikis.
router.get('/api/projects', async (req, res, next) => {
  try {
    res.json(await catalog.projects());
  } catch (err) {
    next(err);
  }
});

// Step 2: the wikis of a project, listed by language ("Bangla · বাংলা").
// ?db=bnwiki answers which project a wiki belongs to, for pre-filled forms.
router.get('/api/wikis', async (req, res, next) => {
  try {
    if (typeof req.query.db === 'string') return res.json({ project: await catalog.projectOf(req.query.db.slice(0, 64)) });
    const family = typeof req.query.project === 'string' ? req.query.project.slice(0, 30) : '';
    const [wikis, names] = await Promise.all([catalog.searchWikis(q(req), family ? 400 : 20, { family }), catalog.names()]);
    // The best-known single wikis first.
    if (family === 'special') {
      const first = ['commonswiki', 'wikidatawiki', 'metawiki', 'specieswiki', 'mediawikiwiki', 'wikifunctionswiki', 'incubatorwiki', 'sourceswiki'];
      const rank = (db) => (first.includes(db) ? first.indexOf(db) : first.length);
      wikis.sort((a, b) => rank(a.dbname) - rank(b.dbname) || a.name.localeCompare(b.name));
    }
    res.json(
      wikis.map((w) => {
        const lang = w.lang && family && family !== 'special' ? names.language(w.lang) : null;
        const local = names.wiki(w.dbname).localName;
        return {
          value: w.dbname,
          // Within a project, the language is what tells wikis apart.
          text: family && lang ? lang.name : w.name || w.dbname,
          localName: family && lang ? lang.localName : local,
          name: w.name,
          url: w.url,
          lang: w.lang,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/api/wikis/:dbname/namespaces', async (req, res, next) => {
  try {
    const rows = await catalog.namespacesFor(req.params.dbname);
    res.json(rows.map((n) => ({ value: n.id, text: `${n.id} · ${n.name}`, content: n.content })));
  } catch (err) {
    if (err instanceof wikiApi.WikiApiError) return res.status(502).json({ error: err.message });
    next(err);
  }
});

router.get('/api/languages', async (req, res, next) => {
  try {
    const langs = await catalog.searchLanguages(q(req));
    res.json(langs.map((l) => ({ value: l.code, text: l.localName && l.localName !== l.name ? `${l.name} · ${l.localName}` : l.name, local: l.localName || l.name, code: l.code })));
  } catch (err) {
    next(err);
  }
});

// Global Wikimedia accounts starting with the typed text.
router.get('/api/users', requireAuth, async (req, res, next) => {
  const term = q(req).replace(/_/g, ' ').trim();
  if (term.length < 2) return res.json([]);
  const prefix = term.charAt(0).toUpperCase() + term.slice(1);
  try {
    const data = await wikiApi.get('metawiki', { action: 'query', list: 'globalallusers', agufrom: prefix, aguprefix: prefix, agulimit: '10' });
    res.json((data.query?.globalallusers || []).map((u) => ({ value: u.name, text: u.name })));
  } catch (err) {
    if (err instanceof wikiApi.WikiApiError) return res.json([]);
    next(err);
  }
});

module.exports = router;
