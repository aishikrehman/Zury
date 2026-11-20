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
      // A new event (photos on Commons) that tracks the campaign.
      const cw = require('../services/campwizService');
      const info = await cw.tracked({ url: value, category }).then((d) => d.info).catch(() => null);
      const title = (info && info.name) || cw.categoryName(category) || 'CampWiz campaign';
      const contest = await require('../services/eventService').create({
        actorId: req.user.id, type: 'photo', autoSlug: true,
        parsed: { contest: { slug: title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'campwiz', title: title.slice(0, 1000), description: '', primaryWiki: 'commonswiki', startDate: info && info.start ? new Date(info.start) : null, endDate: info && info.end ? new Date(info.end) : null, submissionOpensAt: info && info.start ? new Date(info.start) : null, submissionDeadline: info && info.end ? new Date(info.end) : null }, settings: { juryReviewEnabled: false } },
      });
      await trackers.add({ level: 'event', levelId: contest.id, kind: 'campwiz', code: value, category, actorId: req.user.id });
      req.flash('success', req.t('Tracking; nothing is copied.'));
      return res.redirect((await prisma.contest.findUnique({ where: { id: contest.id }, select: { path: true } })).path + '/statistics');
    }
    const { contest, existed } = await fountain.importEvent({ actorId: req.user.id, input: value, type, trackOnly: trackOnlyOf(req), series: where });
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

module.exports = { importForm, importEvent, link, sync, unlink };

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
