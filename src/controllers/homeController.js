const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');
const { ensureCsrfToken } = require('../middleware/csrf');
const env = require('../config/env');

async function index(req, res, next) {
  // Like GitHub: the home page is for visitors; people who are logged in start on their dashboard.
  if (req.user && req.query.home !== '1') return res.redirect('/dashboard');
  try {
    const [active, upcoming, completed, stats, platform] = await Promise.all([
      contestService.listByGroup('active'),
      contestService.listByGroup('upcoming'),
      contestService.listByGroup('completed'),
      Promise.all([
        prisma.contest.count({ where: { deletedAt: null, visibility: 'public', status: { not: 'draft' } } }),
        prisma.submission.count({ where: { contest: { deletedAt: null } } }),
        prisma.user.count(),
        prisma.submission.groupBy({ by: ['wiki'], where: { contest: { deletedAt: null } } }).then((rows) => rows.length),
      ]),
      statsService.platformStats(),
    ]);
    // The demo user picker in the login wizard posts a form, which needs a token.
    let demoUsers = [];
    if (env.demoMode && !req.user) {
      ensureCsrfToken(req, res);
      demoUsers = (await require('./demoController').switchable()).map((u) => ({ id: u.id, username: u.username }));
    }
    res.render('pages/home', {
      title: 'Zury — Wikimedia Contests & Events',
      stats: { events: stats[0], submissions: stats[1], users: stats[2], wikis: stats[3] },
      demoUsers,
      trend: platform.submissions,
      active,
      upcoming,
      completed,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { index };
