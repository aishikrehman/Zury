const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');

async function index(req, res, next) {
  // Like GitHub: the home page is for visitors; people who are logged in start on their dashboard.
  if (req.user && req.query.home !== '1') return res.redirect('/dashboard');
  try {
    // Every running event, from any wiki.
    const [active, eventCount, platform, home] = await Promise.all([
      contestService.listByGroup('active', 60),
      prisma.contest.count({ where: { deletedAt: null, visibility: 'public', status: { not: 'draft' } } }),
      statsService.platformStats(),
      require('../services/homeService').overview(),
    ]);
    res.render('pages/home', {
      home,
      title: 'Zury — Wikimedia Contests & Events',
      stats: { events: eventCount },
      trend: platform.submissions,
      active,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
