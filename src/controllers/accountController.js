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
    const inEvents = new Set(myEvents.map((e) => e.contest.id));
    // Suggested: running or coming events the person isn't in, on wikis in their language
    // (Bangla: every Bangla wiki — Wikipedia, Wikisource, Wiktionary…), plus events spanning several wikis.
    const langCode = req.user.preferredLanguage || req.lang || 'bn';
    const inLang = (w) => (w || '').startsWith(langCode) && ['wiki', 'wikisource', 'wiktionary', 'wikibooks', 'wikiquote', 'wikivoyage', 'wikinews', 'wikiversity'].includes((w || '').slice(langCode.length));
    const suggested = (await prisma.contest.findMany({
      where: { deletedAt: null, visibility: 'public', status: { in: ['active', 'upcoming', 'published'] } },
      include: { series: true, wikis: { select: { wiki: true } } },
      orderBy: [{ endDate: 'asc' }],
      take: 60,
    }).catch(() => []))
      .filter((ev) => !inEvents.has(ev.id) && (!ev.approval || ev.approval === 'approved'))
      .filter((ev) => inLang(ev.primaryWiki) || (ev.wikis || []).some((w) => inLang(w.wiki)) || (ev.wikis || []).length > 1)
      .sort((x, y) => Number(y.status === 'active') - Number(x.status === 'active'))
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
    // Your entries (with filters), shown on the dashboard.
    const submissionService = require('../services/submissionService');
    const mineFilters = {
      status: submissionService.STATUSES.includes(req.query.status) ? req.query.status : '',
      contestId: Number.parseInt(req.query.event, 10) || null,
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
      sort: Object.keys(submissionService.MINE_SORTS).includes(req.query.sort) ? req.query.sort : 'newest',
    };
    const mine = await submissionService.listMine(req.user.id, mineFilters);
    // Organizers: each running event they run, with today's entries, those waiting for review and participants.
    const day = new Date(Date.now() - 86400000);
    const runIds = myEvents.filter((e) => e.roles.includes('organizer') && ['active', 'submission_closed', 'under_review'].includes(e.contest.status)).map((e) => e.contest.id).slice(0, 8);
    const [todayRows, waitRows, peopleRows] = runIds.length ? await Promise.all([
      prisma.submission.groupBy({ by: ['contestId'], where: { contestId: { in: runIds }, submittedAt: { gte: day } }, _count: { _all: true } }),
      prisma.submission.groupBy({ by: ['contestId'], where: { contestId: { in: runIds }, status: { in: ['pending', 'validated', 'under_review'] } }, _count: { _all: true } }),
      prisma.contestMembership.groupBy({ by: ['contestId'], where: { contestId: { in: runIds }, role: 'participant', status: 'active' }, _count: { _all: true } }),
    ]) : [[], [], []];
    const countOf = (rows, id) => (rows.find((r) => r.contestId === id) || { _count: { _all: 0 } })._count._all;
    const running = myEvents.filter((e) => runIds.includes(e.contest.id)).map((e) => ({ contest: e.contest, today: countOf(todayRows, e.contest.id), waiting: countOf(waitRows, e.contest.id), people: countOf(peopleRows, e.contest.id) }));
    res.render('pages/account/dashboard', {
      running,
      reviewerPatrol: await (async () => {
        const live = { deletedAt: null, status: { notIn: ['archived', 'cancelled', 'draft'] } };
        const [appeals, grown] = await Promise.all([
          prisma.appeal.findMany({ where: { status: 'open', submission: { reviews: { some: { jurorId: req.user.id } } }, contest: live }, orderBy: { createdAt: 'desc' }, take: 8, select: { createdAt: true, submission: { select: { title: true } }, contest: { select: { title: true, path: true, id: true } } } }),
          prisma.submission.findMany({ where: { status: 'rejected', reviews: { some: { jurorId: req.user.id } }, metadata: { contains: '"grew"' }, contest: live }, orderBy: { updatedAt: 'desc' }, take: 8, select: { id: true, title: true, metadata: true, contest: { select: { title: true, path: true, id: true } } } }),
        ]);
        return [
          ...appeals.map((a) => ({ kind: 'appeal', title: a.submission.title, contest: a.contest, href: (a.contest.path || '') + '/patrol?show=appeals' })),
          ...grown.map((s) => { let g = null; try { g = JSON.parse(s.metadata || '{}').watch.grew; } catch { g = null; } return { kind: 'grew', title: s.title, contest: s.contest, grew: g, href: (s.contest.path || '') + '/review?entry=' + s.id }; }),
        ];
      })(),
      notable: (await prisma.submission.findMany({
        where: { participantId: req.user.id, contest: { deletedAt: null, status: 'active' }, OR: [{ status: 'rejected' }, { status: 'approved', reviews: { some: { comment: { not: '' } } } }] },
        orderBy: { updatedAt: 'desc' }, take: 8,
        select: { title: true, status: true, contest: { select: { title: true, path: true, id: true } }, reviews: { where: { comment: { not: '' } }, select: { comment: true }, orderBy: { updatedAt: 'desc' }, take: 1 } },
      })).map((s) => ({ ...s, comment: s.reviews[0] ? s.reviews[0].comment : '' })),
      notes: (await require('../services/notificationService').latest(req.user.id, 5)).map((n) => ({ ...n, text: require('../services/notificationService').text(req.t, n) })),
      mine, filters: mineFilters, statuses: submissionService.STATUSES, withdrawable: submissionService.WITHDRAWABLE,
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
