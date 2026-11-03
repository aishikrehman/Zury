const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const { ensureCsrfToken } = require('../middleware/csrf');
const { PUBLIC_LAYOUT } = require('../utils/layouts');
const env = require('../config/env');

async function index(req, res, next) {
  try {
    const [active, upcoming, completed, stats] = await Promise.all([
      contestService.listByGroup('active'),
      contestService.listByGroup('upcoming'),
      contestService.listByGroup('completed'),
      Promise.all([
        prisma.contest.count({ where: { deletedAt: null, visibility: 'public', status: { not: 'draft' } } }),
        prisma.submission.count({ where: { contest: { deletedAt: null } } }),
        prisma.user.count(),
      ]),
    ]);
    // The demo user picker in the login wizard posts a form, which needs a token.
    let demoUsers = [];
    if (env.demoMode && !req.user) {
      ensureCsrfToken(req, res);
      demoUsers = await prisma.user.findMany({ where: { isDemo: true }, select: { id: true, username: true }, orderBy: { wikimediaId: 'desc' } });
    }
    res.locals.layoutKey = PUBLIC_LAYOUT;
    res.render('pages/home', {
      title: 'Zury — Wikimedia Contests & Events',
      stats: { events: stats[0], submissions: stats[1], users: stats[2] },
      demoUsers,
      sections: [
        { key: 'active', heading: 'Active events', items: active, empty: 'No active events right now.' },
        { key: 'upcoming', heading: 'Upcoming events', items: upcoming, empty: 'No upcoming events yet.' },
        { key: 'completed', heading: 'Recently completed', items: completed, empty: 'No completed events yet.' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

function about(req, res) {
  res.locals.layoutKey = PUBLIC_LAYOUT;
  res.render('pages/about', { title: 'About — Zury' });
}

module.exports = { index, about };
