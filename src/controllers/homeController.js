const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');

async function index(req, res, next) {
  // Like GitHub: the home page is for visitors; people who are logged in start on their dashboard.
  if (req.user && req.query.home !== '1') return res.redirect('/dashboard');
  try {
    // Every running event, from any wiki.
    const [active, eventCount, platform, home] = await Promise.all([
      contestService.listByGroup('active', 200),
      prisma.contest.count({ where: { deletedAt: null, visibility: 'public', status: { not: 'draft' } } }),
      statsService.platformStats(),
      require('../services/homeService').overview(),
    ]);
    const calendar = await require('../services/calendarService').month(req.query.month, { visibility: 'public' });
    // Running now: the same series and edition side by side; ten at most (the rest under "See all").
    const groupKey = (c) => (c.editionOf && c.editionOf.series ? c.editionOf.series.slug : c.series ? c.series.slug : '~' + c.title) + '|' + (c.editionId || 0);
    const activeAll = [...active].sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.title.localeCompare(b.title));
    const recentDone = await contestService.listByGroup('completed', 6).catch(() => []);
    res.render('pages/home', {
      activeTotal: activeAll.length,
      recentDone,
      home,
      title: 'Zury — Wikimedia Contests & Events',
      stats: { events: eventCount },
      trend: platform.submissions,
      active: activeAll.slice(0, 10),
      calendar,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
