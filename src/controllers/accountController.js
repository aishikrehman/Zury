const prisma = require('../config/prisma');
const userService = require('../services/userService');
const contestService = require('../services/contestService');
const statsService = require('../services/statsService');
const catalogService = require('../wiki/catalogService');


async function dashboard(req, res, next) {
  try {
    const canSeePending = req.permissions.has('manageAnyEvent') || req.permissions.has('importEvents');
    const [myEvents, submissionCount, activity, calendar, pendingWikis, myCounts] = await Promise.all([
      contestService.listForUser(req.user.id),
      prisma.submission.count({ where: { participantId: req.user.id, contest: { deletedAt: null } } }),
      statsService.userStats(req.user.id),
      require('../services/calendarService').month(req.query.month, { memberships: { some: { userId: req.user.id, status: 'active' } } }),
      // Wikis asking to join an event, for those who can approve them.
      canSeePending ? prisma.contestWiki.findMany({ where: { status: 'pending', contest: { deletedAt: null } }, include: { contest: { include: { series: true } } }, orderBy: { createdAt: 'asc' }, take: 20 }) : [],
      require('../services/submissionService').myCountsByEvent(req.user.id),
    ]);
    const approvals = await require('../services/approvalService').pendingFor(req);
    // Suggested: public running or upcoming events they are not in yet, their language's wikis first.
    const lang = req.user.preferredLanguage || req.locale || 'bn';
    const mine = new Set(myEvents.map((e) => e.contest.id));
    const suggested = (await prisma.contest.findMany({
      where: { deletedAt: null, visibility: 'public', status: { in: ['active', 'upcoming', 'published'] } },
      include: { series: true },
      orderBy: { startDate: 'desc' },
      take: 40,
    }).catch(() => []))
      .filter((c) => !mine.has(c.id) && (!c.approval || c.approval === 'approved'))
      // Events on a wiki in the person's language first; the event's own language field isn't reliable.
      .sort((x, y) => Number((y.primaryWiki || '').startsWith(lang)) - Number((x.primaryWiki || '').startsWith(lang)))
      .slice(0, 6);
    // Deadlines coming up in the running events they're in.
    const now = Date.now();
    const deadlines = myEvents.filter((e) => e.contest.status === 'active' && e.contest.endDate && new Date(e.contest.endDate).getTime() > now)
      .sort((x, y) => new Date(x.contest.endDate) - new Date(y.contest.endDate)).slice(0, 5)
      .map((e) => ({ contest: e.contest, days: Math.ceil((new Date(e.contest.endDate).getTime() - now) / 86400000) }));
    // Reviewers: entries waiting for them in each event they review (running or under review).
    const reviewService = require('../services/reviewService');
    const juryOpen = myEvents.filter((e) => e.roles.includes('jury') && ['active', 'submission_closed', 'under_review'].includes(e.contest.status)).slice(0, 8);
    const waiting = (await Promise.all(juryOpen.map(async (e) => {
      const settings = await prisma.contestSettings.findUnique({ where: { contestId: e.contest.id } });
      if (!settings || !settings.juryReviewEnabled) return null;
      const q = await reviewService.queue({ contestId: e.contest.id, settings, jurorId: req.user.id }).catch(() => null);
      return q && q.remaining ? { contest: e.contest, n: q.remaining } : null;
    }))).filter(Boolean);
    // Organizers: Patrol room marks (deleted, redirected, moved, much shorter articles).
    const watch = require('../services/articleWatchService');
    const orgIds = myEvents.filter((e) => e.roles.includes('organizer')).map((e) => e.contest.id).slice(0, 30);
    const flaggedRows = orgIds.length ? await prisma.submission.findMany({ where: { contestId: { in: orgIds }, status: { not: 'withdrawn' }, metadata: { contains: '"watch"' } }, select: { contestId: true, metadata: true } }) : [];
    const patrolBy = new Map();
    for (const r of flaggedRows) if (watch.flagsOf(r).length) patrolBy.set(r.contestId, (patrolBy.get(r.contestId) || 0) + 1);
    const patrol = myEvents.filter((e) => patrolBy.has(e.contest.id)).map((e) => ({ contest: e.contest, n: patrolBy.get(e.contest.id) }));
    // Their own contribution, over all events.
    const [mine1] = await prisma.$queryRaw`SELECT COUNT(*) AS entries, COALESCE(SUM(status = 'approved'), 0) AS accepted, COALESCE(SUM(CASE WHEN status = 'approved' THEN wordCount ELSE 0 END), 0) AS words, COUNT(DISTINCT contestId) AS events FROM Submission WHERE participantId = ${req.user.id} AND status <> 'withdrawn'`;
    const contribution = { entries: Number(mine1.entries || 0), accepted: Number(mine1.accepted || 0), words: Number(mine1.words || 0), events: Number(mine1.events || 0) };
    res.render('pages/account/dashboard', {
      deadlines, waiting, patrol, contribution,
      approvals,
      suggested,
      title: 'Dashboard — Zury',
      myEvents,
      myCounts,
      submissionCount,
      activity,
      calendar,
      pendingWikis,
      juryEvents: myEvents.filter((e) => e.roles.includes('jury')),
      wikiRoles: req.subject.user.wikiRoles,
    });
  } catch (err) {
    next(err);
  }
}

const { userPath } = require('../utils/format');
const prefsUrl = (req, query = '') => `${userPath(req.user.username)}${query}#preferences`;

// Preferences live on your own profile.
function showSettings(req, res) {
  res.redirect(prefsUrl(req, req.query.saved === '1' ? '?saved=1' : ''));
}

async function updateSettings(req, res, next) {
  try {
    const catalog = await catalogService.validators();
    const { errors, values } = userService.validatePreferences(req.body, catalog.language);
    if (Object.keys(errors).length) {
      req.flash('danger', req.t(Object.values(errors)[0]));
      return res.redirect(prefsUrl(req));
    }
    await userService.updatePreferences(req.user.id, values);
    res.redirect(prefsUrl(req, '?saved=1'));
  } catch (err) {
    next(err);
  }
}

// Profile picture: a file on Commons, or none.
async function updateAvatar(req, res, next) {
  const { thumbnailFor, AvatarError } = require('../services/commonsAvatarService');
  try {
    if (req.body.remove === '1') {
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
      req.flash('success', 'Profile picture removed.');
    } else {
      const { url } = await thumbnailFor(req.body.file);
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: url } });
      req.flash('success', 'Profile picture saved.');
    }
  } catch (err) {
    if (!(err instanceof AvatarError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(prefsUrl(req));
}

module.exports = { dashboard, showSettings, updateSettings, updateAvatar };

async function approval(req, res, next) {
  try {
    const ok = await require('../services/approvalService').decide(req, req.params.kind, Number(req.params.id), req.params.action);
    if (!ok) return next();
    req.flash('success', req.params.action === 'approve' ? req.t('Approved.') : req.t('Not approved.'));
  } catch (err) {
    return next(err);
  }
  res.redirect('/dashboard');
}
module.exports.approval = approval;
