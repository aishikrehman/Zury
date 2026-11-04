const prisma = require('../config/prisma');
const fountain = require('../services/fountainService');
const { EventWikiError } = require('../services/eventWikiService');

// Fountain counts Wikipedia articles: a writing contest or an edit-a-thon.
const TYPES = ['writing', 'editathon'];

function importForm(req, res) {
  res.render('pages/events/import', { title: 'Import from Fountain — Zury', value: '', type: 'writing', types: TYPES, error: '' });
}

async function importEvent(req, res, next) {
  const value = String(req.body.code || '').trim();
  const type = TYPES.includes(req.body.type) ? req.body.type : 'writing';
  try {
    const { contest, existed } = await fountain.importEvent({ actorId: req.user.id, input: value, type });
    req.flash('success', req.t(existed ? 'This editathon is already in Zury.' : 'Imported from Fountain.'));
    res.redirect(`/${contest.slug}`);
  } catch (err) {
    if (!(err instanceof fountain.FountainError)) return next(err);
    res.status(400).render('pages/events/import', { title: 'Import from Fountain — Zury', value, type, types: TYPES, error: req.t(err.message) });
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

const summary = (req, r) => req.t('Fountain: {added} new, {updated} updated.', { added: r.added, updated: r.updated });

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
