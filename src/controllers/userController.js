const prisma = require('../config/prisma');
const contestService = require('../services/contestService');
const { buildSubject } = require('../services/permissionService');

async function showProfile(req, res, next) {
  try {
    const profileUser = await prisma.user.findUnique({
      where: { username: req.params.username },
      include: { globalRoles: true, wikiRoles: true },
    });
    if (!profileUser || profileUser.status !== 'active') {
      return res.status(404).render('pages/404', { title: 'User Not Found' });
    }
    // No public profiles: this page is for its owner (and platform admins). Others see a
    // person's work on the event, edition or series pages (/EVENT/user/NAME).
    const own = req.user?.id === profileUser.id;
    if (!own && !req.permissions?.has('managePlatformRoles')) {
      return res.status(404).render('pages/404', { title: 'User Not Found' });
    }
    // Public page: only public events are listed, even to the user themself.
    const events = await contestService.listForUser(profileUser.id, { publicOnly: true });
    // Numbers: entries, accepted, words, reviews; and each event's own counts for the cards.
    const uid = profileUser.id;
    const [subs, acc, words, reviews, perEvent, perEventRev] = await Promise.all([
      prisma.submission.count({ where: { participantId: uid, status: { not: 'withdrawn' } } }),
      prisma.submission.count({ where: { participantId: uid, status: 'approved' } }),
      prisma.submission.aggregate({ where: { participantId: uid, status: 'approved' }, _sum: { wordCount: true } }),
      prisma.review.count({ where: { jurorId: uid } }),
      prisma.submission.groupBy({ by: ['contestId', 'status'], where: { participantId: uid, status: { not: 'withdrawn' } }, _count: { _all: true } }),
      prisma.review.groupBy({ by: ['contestId'], where: { jurorId: uid }, _count: { _all: true } }),
    ]);
    const mine = {};
    for (const r of perEvent) { const m = mine[r.contestId] || (mine[r.contestId] = { entries: 0, accepted: 0, reviews: 0 }); m.entries += r._count._all; if (r.status === 'approved') m.accepted += r._count._all; }
    for (const r of perEventRev) { const m = mine[r.contestId] || (mine[r.contestId] = { entries: 0, accepted: 0, reviews: 0 }); m.reviews = r._count._all; }
    res.locals.numbers = { entries: subs, accepted: acc, words: words._sum.wordCount || 0, reviews };
    res.locals.mine = mine;
    res.locals.show = ['organized', 'reviewer', 'participated'].includes(req.query.show) ? req.query.show : null;
    res.locals.when = ['running', 'done'].includes(req.query.when) ? req.query.when : 'all';
    res.render('pages/users/profile', {
      title: `${profileUser.username} — Zury`,
      profileUser,
      profileSubject: buildSubject(profileUser),
      isOwnProfile: req.user?.id === profileUser.id,
      organized: events.filter((e) => e.roles.includes('organizer')),
      judged: events.filter((e) => e.roles.includes('jury')),
      participated: events.filter((e) => e.roles.includes('participant')),
      prefs: req.user?.id === profileUser.id ? { values: { preferredLanguage: req.user.preferredLanguage, timezone: req.user.timezone }, errors: {}, saved: req.query.saved === '1', timezones: require('../utils/time').TIMEZONES } : null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { showProfile };
