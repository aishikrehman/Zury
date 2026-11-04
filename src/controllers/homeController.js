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
    // The demo user picker in the login wizard posts a form, which needs a token.
    let demoUsers = [];
    if (env.demoMode && !req.user) {
      ensureCsrfToken(req, res);
      demoUsers = (await require('./demoController').switchable()).map((u) => ({ id: u.id, username: u.username }));
    }
    // Yours first: events in your language and events that span several wikis, unless you ask for all.
    const lang = (req.user && req.user.preferredLanguage) || req.lang || res.locals.lang?.code || 'en';
    const all = req.query.all === '1';
    const mineFirst = (c) => (c.wikis || []).length > 1 || c.language === lang || (c.primaryWiki || '').startsWith(lang) || (c.wikis || []).some((w) => (w.wiki || '').startsWith(lang));
    const pick = (list) => (all ? list : list.filter(mineFirst));
    // The calendar: one month, ?month=2026-11.
    const m = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
    const today = new Date();
    const year = m ? Number(m[1]) : today.getUTCFullYear();
    const mon = m ? Number(m[2]) - 1 : today.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, mon, 1));
    const monthEnd = new Date(Date.UTC(year, mon + 1, 1));
    const calendarEvents = await prisma.contest.findMany({
      where: { deletedAt: null, visibility: 'public', status: { notIn: ['draft', 'cancelled'] }, startDate: { lt: monthEnd }, endDate: { gte: monthStart } },
      select: { id: true, slug: true, title: true, type: true, startDate: true, endDate: true, edition: true, language: true, primaryWiki: true, series: { select: { slug: true } }, wikis: { select: { wiki: true } } },
      orderBy: { startDate: 'asc' },
    });
    res.render('pages/home', {
      homeLang: lang,
      all,
      shown: { active: pick(active), upcoming: pick(upcoming), completed: pick(completed) },
      calendar: { year, month: mon, start: monthStart, events: all ? calendarEvents : calendarEvents.filter(mineFirst) },
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
