const trackingService = require('../services/trackingService');

async function show(req, res, next) {
  if (!req.settings.publicStatisticsEnabled && !req.permissions.has('viewStatistics')) {
    const err = new Error("This event's statistics aren't public.");
    err.status = 403;
    return next(err);
  }
  try {
    res.render('pages/contest/tracking', {
      title: `Contributions — ${req.contest.title}`,
      summary: await trackingService.summary(req.contest.id, { wiki: req.wikiScope?.wiki }),
      tracking: trackingService.enabledFor(req.settings),
      trackedAt: req.eventSettings.trackedAt,
      sources: trackingService.SOURCES,
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { added, errors } = await trackingService.refresh({ contest: req.contest, settings: req.eventSettings, eventWikis: req.eventWikis });
    req.flash(errors.length ? 'warning' : 'success', `${added} new contribution${added === 1 ? '' : 's'} found.${errors.length ? ` Some wikis could not be read: ${errors.join('; ')}` : ''}`);
  } catch (err) {
    return next(err);
  }
  res.redirect(`${req.base}/tracking`);
}

module.exports = { show, refresh };
