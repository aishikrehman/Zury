const eventWikiService = require('../services/eventWikiService');
const catalogService = require('../wiki/catalogService');

const { EventWikiError } = eventWikiService;

async function checkWiki(wiki) {
  const catalog = await catalogService.validators();
  if (!/^[a-z][a-z0-9_]*$/.test(wiki) || !catalog.known(wiki)) throw new EventWikiError('Choose an existing wiki.');
  if (!catalog.open(wiki)) throw new EventWikiError('This wiki is closed.');
}

function handle(fn, success) {
  return async (req, res, next) => {
    try {
      const message = await fn(req);
      req.flash('success', message || success);
    } catch (err) {
      if (!(err instanceof EventWikiError)) return next(err);
      req.flash('danger', err.message);
    }
    res.redirect(`${req.eventBase}/config#wikis`);
  };
}

// Anyone logged in may ask to bring their wiki into the event; a global controller approves.
const request = handle(async (req) => {
  const wiki = String(req.body.wiki || '').trim();
  await checkWiki(wiki);
  await eventWikiService.addWiki({ actorId: req.user.id, contest: req.contest, wiki, status: 'pending', requestedById: req.user.id });
  return `Request to add ${wiki} sent to the event organizers.`;
});

const add = handle(async (req) => {
  const wiki = String(req.body.wiki || '').trim();
  await checkWiki(wiki);
  const row = await eventWikiService.addWiki({ actorId: req.user.id, contest: req.contest, wiki });
  return `${wiki} added as /${row.code}.`;
});

const change = handle(
  (req) => eventWikiService.changeWiki({ actorId: req.user.id, contest: req.contest, wikiId: Number(req.params.wikiId), action: req.params.action }),
  'Wiki updated.',
);

module.exports = { request, add, change };
