const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');

async function index(req, res, next) {
  // Like GitHub: the home page is for visitors; people who are logged in start on their dashboard.
  if (req.user && req.query.home !== '1') return res.redirect('/dashboard');
  try {
    const [active, upcoming, completed, stats, platform] = await Promise.all([
      contestService.listByGroup('active', 60),
      contestService.listByGroup('upcoming', 60),
      contestService.listByGroup('completed', 60),
      Promise.all([
        prisma.contest.count({ where: { deletedAt: null, visibility: 'public', status: { not: 'draft' } } }),
        prisma.submission.count({ where: { contest: { deletedAt: null } } }),
        prisma.user.count(),
        prisma.submission.groupBy({ by: ['wiki'], where: { contest: { deletedAt: null } } }).then((rows) => rows.length),
      ]),
      statsService.platformStats(),
    ]);
    // Yours first: events in your language and events that span several wikis, unless you ask for all.
    const lang = (req.user && req.user.preferredLanguage) || req.lang || res.locals.lang?.code || 'en';
    const all = req.query.all === '1';
    const mineFirst = (c) => (c.wikis || []).length > 1 || c.language === lang || (c.primaryWiki || '').startsWith(lang) || (c.wikis || []).some((w) => (w.wiki || '').startsWith(lang));
    const pick = (list) => (all ? list : list.filter(mineFirst));
    const calendar = await require('../services/calendarService').month(req.query.month, { visibility: 'public' });
    if (!all) calendar.events = calendar.events.filter(mineFirst);
    res.render('pages/home', {
      homeLang: lang,
      all,
      shown: { active: pick(active), upcoming: pick(upcoming), completed: pick(completed) },
      calendar,
      title: 'Zury — Wikimedia Contests & Events',
      stats: { events: stats[0], submissions: stats[1], users: stats[2], wikis: stats[3] },
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
