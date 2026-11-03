// JSON lookups used by the searchable pickers in forms.
const express = require('express');
const catalog = require('../wiki/catalogService');
const wikiApi = require('../wiki/wikiApi');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const q = (req) => (typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '');

router.get('/api/wikis', async (req, res, next) => {
  try {
    const wikis = await catalog.searchWikis(q(req));
    res.json(wikis.map((w) => ({ value: w.dbname, text: w.dbname, url: w.url, sitename: w.sitename, lang: w.lang })));
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
    res.json(langs.map((l) => ({ value: l.code, text: `${l.code} · ${l.name}` })));
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
