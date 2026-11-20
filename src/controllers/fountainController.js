const prisma = require('../config/prisma');
const fountain = require('../services/fountainService');
const { EventWikiError } = require('../services/eventWikiService');

// Fountain counts Wikipedia articles: a writing contest or an edit-a-thon.
const TYPES = ['writing', 'editathon'];

const summary = (req, r) => (r ? req.t('Fountain: {added} new, {updated} updated.', { added: r.added, updated: r.updated }) : req.t('Following on Fountain for its numbers only; nothing is copied.'));
const trackOnlyOf = (req) => req.body.mode !== 'import';

// Where an import can go: a new event on its own, or into a series or one of its editions.
async function targets() {
  const series = await prisma.eventSeries.findMany({
    where: { deletedAt: null, status: { not: 'archived' } },
    select: { slug: true, title: true, editionRecords: { where: { deletedAt: null, status: { not: 'archived' } }, select: { slug: true, title: true }, orderBy: { slug: 'desc' } } },
    orderBy: { title: 'asc' },
    take: 200,
  });
  return series.map((s) => ({ ...s, editions: s.editionRecords }));
}
const seriesOf = (target) => {
  const m = String(target || '').match(/^(s|e):([a-z0-9-]+)(?:\/([a-z0-9~-]+))?$/i);
  return m ? { slug: m[2], edition: m[1] === 'e' ? m[3] : null } : null;
};

function render(req, res, { value = '', type = 'writing', target = '', error = '', status = 200, source = 'fountain', category = '' } = {}) {
  return targets().then((series) =>
    res.status(status).render('pages/events/import', { title: 'Import — Zury', value, type, types: TYPES, target, series, error, source, category }),
  );
}

function importForm(req, res, next) {
  render(req, res).catch(next);
}

async function importEvent(req, res, next) {
  const value = String(req.body.code || '').trim();
  const type = TYPES.includes(req.body.type) ? req.body.type : 'writing';
  const target = String(req.body.target || '');
  const source = req.body.source === 'campwiz' ? 'campwiz' : 'fountain';
  const category = String(req.body.category || '').trim();
  const where = seriesOf(target);
  try {
    // Tracking is open to everyone signed in; importing (copying entries) needs the import right,
    // and putting anything into a series or edition needs the right to run it.
    const importing = source === 'fountain' && !trackOnlyOf(req);
    if (importing && !req.permissions.has('importEvents')) throw new fountain.FountainError('Only organizers with the import right can import; track it instead.');
    if (where && !req.permissions.has('importEvents')) throw new fountain.FountainError('Only those who run the series can add to it.');
    if (where) {
      const sr = await prisma.eventSeries.findFirst({ where: { slug: where.slug, deletedAt: null } });
      if (!sr) throw new fountain.FountainError('Choose a series.');
      where.title = sr.title;
    }
    if (source === 'campwiz') {
      const trackers = require('../services/trackerService');
      // Into a series or an edition: tracked there, no event needed.
      if (where) {
        const ed2 = where.edition ? await prisma.edition.findFirst({ where: { slug: where.edition, series: { slug: where.slug }, deletedAt: null } }) : null;
        const sr = await prisma.eventSeries.findFirst({ where: { slug: where.slug } });
        await trackers.add({ level: ed2 ? 'edition' : 'series', levelId: ed2 ? ed2.id : sr.id, kind: 'campwiz', code: value, category, actorId: req.user.id });
        req.flash('success', req.t('Tracking; nothing is copied.'));
        return res.redirect(ed2 ? `/series/${where.slug}/${where.edition}?tab=statistics` : `/${where.slug}?tab=statistics`);
      }
      // On its own: no event page, only the numbers.
      const t = await trackers.add({ level: 'none', levelId: 0, kind: 'campwiz', code: value, category, actorId: req.user.id });
      req.flash('success', req.t('Tracking; nothing is copied.'));
      return res.redirect('/tracking/' + t.id);
    }
    // Fountain, tracked only: on the series/edition, or on its own — never a new event.
    if (trackOnlyOf(req)) {
      const trackers = require('../services/trackerService');
      if (where) {
        const ed2 = where.edition ? await prisma.edition.findFirst({ where: { slug: where.edition, series: { slug: where.slug }, deletedAt: null } }) : null;
        const sr = await prisma.eventSeries.findFirst({ where: { slug: where.slug } });
        await trackers.add({ level: ed2 ? 'edition' : 'series', levelId: ed2 ? ed2.id : sr.id, kind: 'fountain', code: value, actorId: req.user.id });
        req.flash('success', req.t('Tracking; nothing is copied.'));
        return res.redirect(ed2 ? `/series/${where.slug}/${where.edition}?tab=statistics` : `/${where.slug}?tab=statistics`);
      }
      const t = await trackers.add({ level: 'none', levelId: 0, kind: 'fountain', code: value, actorId: req.user.id });
      req.flash('success', req.t('Tracking; nothing is copied.'));
      return res.redirect('/tracking/' + t.id);
    }
    const { contest, existed } = await fountain.importEvent({ actorId: req.user.id, input: value, type, trackOnly: false, series: where });
    req.flash('success', req.t(existed ? 'This editathon is already in Zury.' : 'Imported from Fountain.'));
    res.redirect((await prisma.contest.findUnique({ where: { id: contest.id }, select: { path: true } })).path);
  } catch (err) {
    if (!(err instanceof fountain.FountainError || err instanceof EventWikiError || (err && /TrackerError|EventError|CampwizError/.test(err.constructor && err.constructor.name)))) return next(err);
    render(req, res, { value, type, target, error: req.t(err.message), status: 400, source, category }).catch(next);
  }
}

function back(req, res, fn) {
  return fn()
    .then((message) => req.flash('success', message))
    .catch((err) => {
      if (!(err instanceof fountain.FountainError || err instanceof EventWikiError)) throw err;
      req.flash('danger', req.t(err.message));
    })
    .then(() => res.redirect(`${req.eventBase}/config#wikis`));
}

function link(req, res, next) {
  back(req, res, async () => summary(req, (await fountain.link({ actorId: req.user.id, contest: req.contest, input: req.body.code, trackOnly: trackOnlyOf(req) })).result)).catch(next);
}

function sync(req, res, next) {
  back(req, res, async () => {
    const row = await prisma.contestWiki.findFirst({ where: { id: Number(req.params.wikiId), contestId: req.contest.id, fountainCode: { not: '' } } });
    if (!row) throw new fountain.FountainError('This wiki does not follow a Fountain editathon.');
    return summary(req, await fountain.sync(row, { actorId: req.user.id }));
  }).catch(next);
}

function unlink(req, res, next) {
  back(req, res, async () => {
    await fountain.unlink({ actorId: req.user.id, contest: req.contest, wikiId: Number(req.params.wikiId) });
    return req.t('No longer following Fountain. Imported entries stay.');
  }).catch(next);
}

// A wiki that only tracked its editathon: from now on its entries are copied (and kept in sync).
function importTracked(req, res, next) {
  back(req, res, async () => {
    const w = await prisma.contestWiki.findFirst({ where: { id: Number(req.params.wikiId), contestId: req.contest.id } });
    if (!w || !w.fountainCode) throw new fountain.FountainError('Nothing to import.');
    await prisma.contestWiki.update({ where: { id: w.id }, data: { fountainTrackOnly: false, fountainAuto: true } });
    return summary(req, await fountain.sync({ ...w, fountainTrackOnly: false }, { actorId: req.user.id }));
  }).catch(next);
}

// Every wiki of the event stops following Fountain at once (entries stay).
function unlinkAll(req, res, next) {
  back(req, res, async () => {
    const rows = await prisma.contestWiki.findMany({ where: { contestId: req.contest.id, fountainCode: { not: '' } }, select: { id: true } });
    for (const r of rows) await fountain.unlink({ actorId: req.user.id, contest: req.contest, wikiId: r.id });
    return req.t('No longer following Fountain. Imported entries stay.');
  }).catch(next);
}

module.exports = { importForm, importEvent, link, sync, unlink, importTracked, unlinkAll };

// Hourly sync on or off for one followed editathon.
async function setAuto(req, res, next) {
  try {
    const prisma = require('../config/prisma');
    await prisma.contestWiki.updateMany({ where: { id: Number(req.params.wikiId), contestId: req.contest.id }, data: { fountainAuto: req.body.auto === 'on' } });
    req.flash('success', req.t(req.body.auto === 'on' ? 'Fountain will be followed every hour.' : 'Fountain is updated only when you ask.'));
  } catch (err) {
    return next(err);
  }
  res.redirect(req.get('referer') || req.base + '/config');
}
module.exports.setAuto = setAuto;
