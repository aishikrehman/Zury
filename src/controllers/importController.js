// Import page (organizers): pick a source, see the preview, confirm.
const importService = require('../services/importService');
const { SubmissionError } = require('../services/submissionService');
const { WikiApiError } = require('../wiki/wikiApi');
const { FountainError } = require('../services/fountainService');

const SOURCES = ['wiki', 'text', 'fountain'];

function form(req) {
  const b = req.body || {};
  const source = SOURCES.includes(b.source) ? b.source : 'wiki';
  return { source, page: String(b.page || '').trim().slice(0, 300), text: String(b.text || '').slice(0, 200000), code: String(b.code || '').trim().slice(0, 300), wiki: String(b.wiki || '').trim() };
}

function render(req, res, data = {}, status = 200) {
  const wikis = (req.eventWikis && req.eventWikis.length ? req.eventWikis.map((w) => w.wiki) : [req.contest.primaryWiki]).filter(Boolean);
  res.status(status).render('pages/contest/import', { title: `Import — ${req.contest.title}`, wikis, f: { source: 'wiki', page: '', text: '', code: '', wiki: wikis[0] || '' }, preview: null, error: null, ...data });
}

async function rowsFor(req, f) {
  const wikis = (req.eventWikis && req.eventWikis.length ? req.eventWikis.map((w) => w.wiki) : [req.contest.primaryWiki]).filter(Boolean);
  if (f.source === 'wiki') {
    const wiki = wikis.includes(f.wiki) ? f.wiki : wikis[0];
    return (await importService.fromWikiPage(wiki, f.page)).map((r) => ({ ...r, wiki }));
  }
  if (f.source === 'text') return importService.fromText(f.text);
  return importService.fromFountain(f.code, wikis);
}

const known = (err) => err instanceof importService.ImportError || err instanceof SubmissionError || err instanceof WikiApiError || err instanceof FountainError;

async function page(req, res) {
  render(req, res);
}

async function preview(req, res, next) {
  const f = form(req);
  try {
    const result = await importService.check({ req, rows: await rowsFor(req, f) });
    render(req, res, { f, preview: result });
  } catch (err) {
    if (known(err)) return render(req, res, { f, error: err.message }, 422);
    next(err);
  }
}

async function commit(req, res, next) {
  const f = form(req);
  try {
    // Checked again on confirm: the sources may have changed since the preview.
    const result = await importService.check({ req, rows: await rowsFor(req, f) });
    if (!result.summary.ready) throw new importService.ImportError('None of these entries can be imported.');
    const done = await importService.commit({ req, preview: result, source: f.source });
    req.flash('success', req.t('{n} entries imported.', { n: done.created }) + (done.reviewed ? ' ' + req.t('{n} reviews brought in.', { n: done.reviewed }) : ''));
    res.redirect(`${req.base}/submissions`);
  } catch (err) {
    if (known(err)) return render(req, res, { f, error: err.message }, 422);
    next(err);
  }
}

module.exports = { page, preview, commit };
