const prisma = require('../config/prisma');
const fountain = require('../services/fountainService');
const { EventWikiError } = require('../services/eventWikiService');

// Fountain counts Wikipedia articles: a writing contest or an edit-a-thon.
const TYPES = ['writing', 'editathon'];

const summary = (req, r) => req.t('Fountain: {added} new, {updated} updated.', { added: r.added, updated: r.updated });

// Events the importer may add a wiki to: all of them for global controllers, else those they organize.
async function targets(req) {
  const where = req.permissions.has('manageEvent')
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId: req.user.id, role: 'organizer', wiki: '', status: 'active' } } };
  const rows = await prisma.contest.findMany({
    where: { ...where, path: { not: null } },
    select: { id: true, title: true, path: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((c) => ({ id: c.id, path: c.path, label: `${c.title} (${c.path})` }));
}

function render(req, res, { value = '', type = 'writing', target = '', error = '', status = 200 } = {}) {
  return targets(req).then((events) =>
    res.status(status).render('pages/events/import', { title: 'Import from Fountain — Zury', value, type, types: TYPES, target, events, error }),
  );
}

function importForm(req, res, next) {
  render(req, res).catch(next);
}

async function importEvent(req, res, next) {
  const value = String(req.body.code || '').trim();
  const type = TYPES.includes(req.body.type) ? req.body.type : 'writing';
  const target = String(req.body.target || '');
  try {
    if (target) {
      // Into an existing event: the editathon becomes one of its wikis.
      const allowed = (await targets(req)).find((e) => String(e.id) === target);
      if (!allowed) throw new fountain.FountainError('Choose an event you organize.');
      const contest = await prisma.contest.findUnique({ where: { id: allowed.id } });
      const { result } = await fountain.link({ actorId: req.user.id, contest, input: value });
      req.flash('success', summary(req, result));
      return res.redirect(allowed.path);
    }
    const { contest, existed } = await fountain.importEvent({ actorId: req.user.id, input: value, type });
    req.flash('success', req.t(existed ? 'This editathon is already in Zury.' : 'Imported from Fountain.'));
    res.redirect((await prisma.contest.findUnique({ where: { id: contest.id }, select: { path: true } })).path);
  } catch (err) {
    if (!(err instanceof fountain.FountainError || err instanceof EventWikiError)) return next(err);
    render(req, res, { value, type, target, error: req.t(err.message), status: 400 }).catch(next);
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
  back(req, res, async () => summary(req, (await fountain.link({ actorId: req.user.id, contest: req.contest, input: req.body.code })).result)).catch(next);
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
