const prisma = require('../config/prisma');
const reviewService = require('../services/reviewService');
const { eventPath } = require('../utils/format');
const { dbnameToHost } = require('../wiki/wikiUrls');

// The page itself, rendered by its wiki, for articles and other text pages.
// Files and Wikidata items have their own previews.
function pagePreview(entry, base) {
  if (!entry || ['file', 'item', 'property', 'lexeme'].includes(entry.entryType)) return null;
  return dbnameToHost(entry.wiki) ? `${base}/review/${entry.id}/preview` : null;
}

const { ReviewError } = reviewService;
const REVIEW_PERMISSION = 'reviewAssignedEntry';

// Wikis this person may judge in this event; null means every wiki.
function judgedWikis(req) {
  if (req.wikiScope) return req.permissions.has(REVIEW_PERMISSION) ? [req.wikiScope.wiki] : [];
  if (req.eventWikis.length <= 1 || req.scope.global.has(REVIEW_PERMISSION)) return req.permissions.has(REVIEW_PERMISSION) ? null : [];
  return req.scope.wikisWith(REVIEW_PERMISSION);
}

const canJudge = (req, submission) => {
  const wikis = judgedWikis(req);
  return wikis === null || wikis.includes(submission.wiki);
};

// The review window's filters, from the address (and kept through each verdict).
function reviewFilters(req) {
  const src = { ...req.query, ...(req.method === 'POST' ? Object.fromEntries(new URLSearchParams(req.body.filters || '')) : {}) };
  return {
    mode: ['open', 'mine'].includes(src.mode) ? src.mode : '',
    participantId: Number.parseInt(src.participant, 10) || null,
    q: typeof src.q === 'string' ? src.q.trim().slice(0, 100) : '',
    minWords: Math.max(0, Number.parseInt(src.minWords, 10) || 0) || null,
    wiki: typeof src.wiki === 'string' && /^[a-z0-9_]+$/.test(src.wiki) ? src.wiki : '',
    sort: Object.keys(reviewService.QUEUE_SORTS).includes(src.sort) && src.sort !== 'oldest' ? src.sort : '',
    maxWords: Math.max(0, Number.parseInt(src.maxWords, 10) || 0) || null,
    status: ['pending', 'validated', 'under_review', 'approved', 'rejected', 'appealed'].includes(src.status) ? src.status : '',
    reviews: ['none', 'some'].includes(src.reviews) ? src.reviews : '',
    checks: src.checks === 'warnings' ? 'warnings' : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(src.from || '') ? new Date(`${src.from}T00:00:00Z`) : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(src.to || '') ? new Date(`${src.to}T23:59:59Z`) : null,
  };
}

function filterQuery(f, extra = {}) {
  const p = new URLSearchParams();
  if (f.mode) p.set('mode', f.mode);
  if (f.participantId) p.set('participant', f.participantId);
  if (f.q) p.set('q', f.q);
  if (f.minWords) p.set('minWords', f.minWords);
  if (f.wiki) p.set('wiki', f.wiki);
  if (f.sort) p.set('sort', f.sort);
  if (f.maxWords) p.set('maxWords', f.maxWords);
  if (f.status) p.set('status', f.status);
  if (f.reviews) p.set('reviews', f.reviews);
  if (f.checks) p.set('checks', f.checks);
  if (f.from) p.set('from', f.from.toISOString().slice(0, 10));
  if (f.to) p.set('to', f.to.toISOString().slice(0, 10));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

// Entries for the picker on the review page: the queue in its order, searched by title, a page at a time.
async function entries(req, res, next) {
  try {
    const wikis = judgedWikis(req);
    if (wikis && !wikis.length) return res.status(403).json({ items: [] });
    const filters = reviewFilters(req);
    const q = await reviewService.queue({ contestId: req.contest.id, settings: req.eventSettings, jurorId: req.user.id, wikis, filters });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = await reviewService.queuePage({ ids: q.ids, q: typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '', page });
    res.json({
      ...result,
      items: result.items.map((r) => ({ value: String(r.id), text: r.title, position: r.position, participant: r.participant.username, words: r.wordCount, status: r.status })),
      next: result.more ? page + 1 : null,
    });
  } catch (err) {
    next(err);
  }
}

// The review window: one entry at a time.
async function window(req, res, next) {
  try {
    const wikis = judgedWikis(req);
    if (wikis && !wikis.length) {
      const err = new Error("You don't have permission to do that.");
      err.status = 403;
      return next(err);
    }
    const after = Number(req.query.after) || 0;
    const filters = reviewFilters(req);
    // "Go to": an entry by its number or title, among the ones this person may judge.
    if (typeof req.query.go === 'string' && req.query.go.trim()) {
      const go = req.query.go.trim().replace(/^#/, '');
      const found = await prisma.submission.findFirst({
        where: { contestId: req.contest.id, ...(wikis && { wiki: { in: wikis } }), OR: [...(/^\d+$/.test(go) ? [{ id: Number(go) }] : []), { title: { contains: go } }] },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (!found) req.flash('warning', req.t('No entry matches “{q}”.', { q: go.slice(0, 80) }));
      return res.redirect(`${req.base}/review?${filterQuery(filters, found ? { entry: found.id } : {})}`);
    }
    const q = await reviewService.queue({ contestId: req.contest.id, settings: req.eventSettings, jurorId: req.user.id, wikis, after, filters });
    const id = Number(req.query.entry) || q.nextId;
    const entry = id ? await reviewService.entryForReview(req.contest.id, id) : null;
    if (entry && !canJudge(req, entry)) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
    // Entries brought in with little data (e.g. from Fountain): the page's details are fetched once and kept.
    if (entry && entry.entryType === 'article') {
      let m = {}; try { m = JSON.parse(entry.metadata || '{}'); } catch { m = {}; }
      if (!m.createdAt || m.sizeBytes == null) {
        const fresh = await require('../wiki/entryMetadata').fetchEntryMetadata({ wiki: entry.wiki, title: entry.title }, { language: req.contest.language }).catch(() => null);
        if (fresh && fresh.exists) {
          const merged = { ...fresh, ...m, createdAt: fresh.createdAt, creator: fresh.creator, sizeBytes: m.sizeBytes ?? fresh.sizeBytes, currentRevId: fresh.revId };
          entry.metadata = JSON.stringify(merged);
          await require('../config/prisma').submission.update({ where: { id: entry.id }, data: { metadata: entry.metadata } }).catch(() => null);
        }
      }
    }
    const revMode = require('../services/participationService').read(req.settings).rules.revision === 'latest' ? 'latest' : 'pinned';
    let revChanged = false;
    if (entry && revMode === 'pinned' && entry.revId && !req.contest.resultsPublishedAt) {
      const host = require('../wiki/wikiUrls').dbnameToHost(entry.wiki);
      const q = new URLSearchParams({ action: 'query', prop: 'info', titles: entry.title, format: 'json', formatversion: '2' });
      const info = host ? await fetch(`https://${host}/w/api.php?${q}`, { headers: { 'User-Agent': require('../config/env').userAgent } }).then((r) => r.json()).catch(() => null) : null;
      const last = info && info.query && info.query.pages && info.query.pages[0] && info.query.pages[0].lastrevid;
      revChanged = !!(last && last !== entry.revId);
    }
    res.locals.revMode = revMode;
    res.locals.revChanged = revChanged;
    const handTo = entry ? await reviewService.handOverChoices({ contest: req.contest, settings: req.eventSettings, entry, me: req.user.id }).catch(() => []) : [];
    res.render('pages/contest/review', {
      title: `Review — ${req.contest.title}`,
      handTo,
      entry,
      meta: entry ? JSON.parse(entry.metadata || '{}') : null,
      preview: pagePreview(entry, req.base),
      validation: entry ? JSON.parse(entry.validation || '{}') : null,
      mine: entry ? entry.reviews.find((r) => r.jurorId === req.user.id) || null : null,
      // Secret ballot: other reviews stay hidden from reviewers until the entry is decided.
      others: entry && !(req.eventSettings.secretBallot && ['pending', 'validated', 'under_review'].includes(entry.status) && !req.scope.permissions.has('manageEvent')) ? entry.reviews.filter((r) => r.jurorId !== req.user.id) : [],
      scheme: reviewService.markScheme(req.eventSettings),
      required: Math.max(1, req.eventSettings.requiredReviews || 1),
      queue: q,
      progress: await reviewService.progress(req.contest.id, { wiki: req.wikiScope?.wiki }),
      // Reviewer statistics: for everyone when the event shows them, else for its organizers.
      activity: (() => { const r = require('../services/participationService').read(req.eventSettings).rules.stats; const org = req.scope.permissions.has('manageEvent'); return org ? r !== 'off' || true : r === 'anyone' || r === 'reviewers'; })() ? await reviewService.juryActivity(req.contest.id, { wiki: req.wikiScope?.wiki }) : [],
      position: id ? q.ids.indexOf(id) + 1 : 0,
      filters,
      filterQuery,
      // People with entries here, for the participant filter (the busiest 200).
      writers: await prisma.submission.groupBy({ by: ['participantId'], where: { contestId: req.contest.id, ...(wikis && { wiki: { in: wikis } }) }, _count: { _all: true }, orderBy: { _count: { participantId: 'desc' } }, take: 200 })
        .then(async (rows) => {
          const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.participantId) } }, select: { id: true, username: true } });
          return users.sort((x, y) => x.username.localeCompare(y.username));
        }),
      reviewWikiList: wikis || req.eventWikis.map((w) => w.wiki),
    });
  } catch (err) {
    next(err);
  }
}

async function save(req, res, next) {
  const id = Number(req.params.submissionId);
  try {
    const entry = await reviewService.entryForReview(req.contest.id, id);
    if (!entry || !canJudge(req, entry)) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
    const marks = {};
    for (const [key, value] of Object.entries(req.body)) if (key.startsWith('mark:')) marks[key.slice(5)] = value;
    const result = await reviewService.saveReview({
      actor: req.user,
      contest: req.contest,
      settings: req.eventSettings,
      submission: entry,
      decision: req.body.decision,
      marks,
      score: req.body.score,
      comment: req.body.comment,
      notify: ['auto', 'bell', 'onwiki', 'none'].includes(req.body.notify) ? req.body.notify : 'auto',
      note: String(req.body.note || '').trim().slice(0, 2000),
    });
    // An on-wiki message to the participant, with the reviewer's own login.
    if (req.body.notify === 'onwiki' && req.session.wikimediaToken && result.decided) {
      const prismaDb = require('../config/prisma');
      const who = await prismaDb.user.findUnique({ where: { id: entry.participantId }, select: { id: true, username: true } }).catch(() => null);
      const text = String(req.body.note || '').trim() || req.t(result.status === 'approved' ? 'Your entry “{title}” in {event} was accepted.' : 'Your entry “{title}” in {event} was not accepted.', { title: entry.title, event: req.contest.title });
      const body = req.body.comment ? text + '\n\n' + req.body.comment : text;
      if (who) await require('../services/messageService').send({ actor: req.user, accessToken: req.session.wikimediaToken, contest: req.contest, method: 'talk', subject: entry.title, body, people: [{ ...who, wiki: entry.wiki }], fallbackWiki: entry.wiki }).catch(() => null);
    }
    req.flash('success', result.decided ? 'Review saved; the entry is decided.' : 'Review saved.');
    res.redirect(`${req.base}/review?${filterQuery(reviewFilters(req), { after: id })}`);
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', err.message);
    res.redirect(`${req.base}/review?${filterQuery(reviewFilters(req), { entry: id })}`);
  }
}

// One verdict for many entries, chosen on the submissions table. Each entry is
// checked as if reviewed alone (the person's wikis, assignments, own entries).
async function bulkSave(req, res, next) {
  if (req.eventSettings.bulkReviewEnabled === false) {
    req.flash('danger', req.t('Bulk review is off for this event.'));
    return res.redirect(`${req.base}/submissions`);
  }
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean).slice(0, 200);
  const marks = {};
  for (const [key, value] of Object.entries(req.body)) if (key.startsWith('mark:')) marks[key.slice(5)] = value;
  let saved = 0;
  const problems = new Set();
  try {
    for (const id of ids) {
      const entry = await reviewService.entryForReview(req.contest.id, id);
      if (!entry || !canJudge(req, entry)) { problems.add('Some entries are not yours to review.'); continue; }
      try {
        await reviewService.saveReview({ actor: req.user, contest: req.contest, settings: req.eventSettings, submission: entry, decision: req.body.decision, marks, comment: req.body.comment });
        saved += 1;
      } catch (err) {
        if (!(err instanceof ReviewError)) throw err;
        problems.add(err.message);
      }
    }
    const text = [saved ? req.t('{n} entries reviewed.', { n: saved }) : '', ...[...problems].map((m) => req.t(m))].filter(Boolean).join(' ');
    if (text) req.flash(problems.size ? (saved ? 'warning' : 'danger') : 'success', text);
    const back = typeof req.body.back === 'string' && req.body.back.startsWith(`${req.base}/`) && !/[\r\n]/.test(req.body.back) ? req.body.back : `${req.base}/submissions`;
    res.redirect(back);
  } catch (err) {
    next(err);
  }
}

// Results and statistics: the ranking is public once published (organizers and jury
// see it before that); the statistics follow the event's statistics setting.
async function results(req, res, next) {
  try {
    const insider = req.permissions.has('reviewEvent') || req.permissions.has('manageEvent');
    const showRanking = !!req.contest.resultsPublishedAt || insider;
    const showStats = req.settings.publicStatisticsEnabled || req.permissions.has('viewStatistics');
    if (!showRanking && !showStats) {
      const err = new Error('The results have not been published yet.');
      err.status = 403;
      return next(err);
    }
    const wiki = req.wikiScope?.wiki;
    const rows = showRanking ? await reviewService.leaderboard({ contest: req.contest, settings: req.eventSettings, wiki }) : [];
    // Word-based events: each person's words by status, in the leaderboard itself.
    if (rows.length && req.settings.wordCountEnabled) {
      const g = await prisma.submission.groupBy({ by: ['participantId', 'status'], where: { contestId: req.contest.id, ...(wiki && { wiki }), status: { not: 'withdrawn' } }, _sum: { wordCount: true } });
      const users = await prisma.user.findMany({ where: { id: { in: [...new Set(g.map((x) => x.participantId))] } }, select: { id: true, username: true } });
      const nameOf = Object.fromEntries(users.map((u) => [u.id, u.username]));
      const by = {};
      for (const x of g) { const k = x.status === 'approved' ? 'approved' : ['rejected', 'disqualified'].includes(x.status) ? 'rejected' : 'pending'; const w = (by[nameOf[x.participantId]] ||= { approved: 0, pending: 0, rejected: 0 }); w[k] += x._sum.wordCount || 0; }
      for (const r of rows) r.wordsBy = by[r.username] || { approved: 0, pending: 0, rejected: 0 };
      rows.withWordsBy = true;
    }
    res.render('pages/contest/results', {
      title: `Results and statistics — ${req.contest.title}`,
      rows,
      // Events without word counts are ranked by points, with no word column.
      showRanking,
      progress: insider || req.eventSettings.juryStatsEnabled !== false ? await reviewService.progress(req.contest.id, { wiki }) : null,
      stats: showStats ? await require('../services/statsService').eventStats(req.contest, { wiki }) : null,
      published: req.contest.resultsPublishedAt,
      showNames: !req.settings.anonymousParticipants || insider || !!req.contest.resultsPublishedAt,
    });
  } catch (err) {
    next(err);
  }
}

async function publish(req, res, next) {
  try {
    const published = req.body.published === '1';
    await reviewService.setResultsPublished({ actor: req.user, contest: req.contest, published });
    req.flash('success', published ? 'Results published.' : 'Results hidden again.');
    res.redirect(`${req.base}/results`);
  } catch (err) {
    next(err);
  }
}

async function appeal(req, res, next) {
  const id = Number(req.params.submissionId);
  try {
    const submission = await prisma.submission.findFirst({ where: { id, contestId: req.contest.id } });
    if (!submission) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
    await reviewService.createAppeal({ user: req.user, contest: req.effective.contest, settings: req.settings, submission, reason: req.body.reason });
    req.flash('success', 'Appeal sent to the organizers.');
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(`${req.base}/submissions`);
}

async function appealsList(req, res, next) {
  try {
    const staff = req.permissions.has('reviewAppeal') || req.permissions.has('manageAppeals') || req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
    const open = require('../services/participationService').read(req.settings).rules.appealsPublic !== 'no';
    let list = await reviewService.appeals(req.contest.id);
    if (!staff && !open) {
      if (!req.user) return res.redirect('/login');
      list = list.filter((a) => a.userId === req.user.id);
    }
    res.render('pages/contest/appeals', { title: `Appeals — ${req.contest.title}`, appeals: list });
  } catch (err) {
    next(err);
  }
}

async function resolve(req, res, next) {
  try {
    await reviewService.resolveAppeal({ actor: req.user, contest: req.contest, appealId: Number(req.params.appealId), action: req.params.action, response: req.body.response });
    req.flash('success', req.params.action === 'uphold' ? 'Appeal upheld; the entry goes back to the reviewers.' : 'Appeal dismissed.');
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(`${req.base}/appeals`);
}

// /review: every event where this person is on the jury, with what's waiting.
// Every event where this person is on the jury, with what is left for them to review.
async function juryEventsFor(userId) {
  const memberships = await prisma.contestMembership.findMany({
    where: { userId, role: 'jury', status: 'active', contest: { deletedAt: null } },
    include: { contest: { include: { series: true, wikis: true, settings: true } } },
  });
  const byContest = new Map();
  for (const m of memberships) {
    const entry = byContest.get(m.contestId) || { contest: m.contest, wikis: [] };
    entry.wikis.push(m.wiki);
    byContest.set(m.contestId, entry);
  }
  const events = [];
  for (const { contest, wikis } of byContest.values()) {
    const all = wikis.includes('') ? null : wikis;
    const q = await reviewService.queue({ contestId: contest.id, settings: contest.settings || {}, jurorId: userId, wikis: all });
    events.push({ contest, path: eventPath(contest), remaining: q.remaining, reviewed: q.reviewedByMe, wikis: all });
  }
  return events.sort((x, y) => y.remaining - x.remaining);
}

async function myQueue(req, res, next) {
  try {
    const userId = req.user.id;
    const events = await juryEventsFor(userId);
    const ids = events.map((e) => e.contest.id);
    const day = 86400000;
    const now = Date.now();
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const since30 = new Date(startToday.getTime() - 29 * day);
    const [mine, byEvent, totals, appeals, recent] = await Promise.all([
      prisma.review.findMany({ where: { jurorId: userId, createdAt: { gte: since30 } }, select: { createdAt: true } }),
      prisma.review.groupBy({ by: ['contestId', 'decision'], where: { jurorId: userId, contestId: { in: ids } }, _count: { _all: true } }),
      prisma.submission.groupBy({ by: ['contestId', 'status'], where: { contestId: { in: ids }, status: { not: 'withdrawn' } }, _count: { _all: true } }),
      prisma.appeal.groupBy({ by: ['contestId'], where: { contestId: { in: ids }, status: 'open' }, _count: { _all: true } }),
      prisma.review.findMany({ where: { jurorId: userId }, orderBy: { updatedAt: 'desc' }, take: 8, select: { decision: true, updatedAt: true, comment: true, submission: { select: { id: true, title: true, wiki: true } }, contest: { select: { id: true, title: true, slug: true, path: true, series: { select: { slug: true } } } } } }),
    ]);
    // My reviews per day, last 30 days.
    const perDay = Array.from({ length: 30 }, (_, i) => ({ at: new Date(since30.getTime() + i * day), n: 0 }));
    for (const r of mine) { const i = Math.floor((r.createdAt - since30) / day); if (perDay[i]) perDay[i].n += 1; }
    let streak = 0; for (let i = perDay.length - 1; i >= 0 && perDay[i].n; i -= 1) streak += 1;
    const weekAgo = new Date(startToday.getTime() - 6 * day);
    const stats = {
      waiting: events.reduce((a, e) => a + e.remaining, 0),
      today: mine.filter((r) => r.createdAt >= startToday).length,
      week: mine.filter((r) => r.createdAt >= weekAgo).length,
      accepted: byEvent.filter((g) => g.decision === 'accept').reduce((a, g) => a + g._count._all, 0),
      rejected: byEvent.filter((g) => g.decision === 'reject').reduce((a, g) => a + g._count._all, 0),
      other: byEvent.filter((g) => !['accept', 'reject'].includes(g.decision)).reduce((a, g) => a + g._count._all, 0),
      perDay, streak,
    };
    const DECIDED = ['approved', 'rejected', 'disqualified'];
    for (const e of events) {
      const id = e.contest.id;
      e.mineAccept = byEvent.filter((g) => g.contestId === id && g.decision === 'accept').reduce((a, g) => a + g._count._all, 0);
      e.mineReject = byEvent.filter((g) => g.contestId === id && g.decision === 'reject').reduce((a, g) => a + g._count._all, 0);
      const t = totals.filter((g) => g.contestId === id);
      e.total = t.reduce((a, g) => a + g._count._all, 0);
      e.decided = t.filter((g) => DECIDED.includes(g.status)).reduce((a, g) => a + g._count._all, 0);
      e.appeals = appeals.find((g) => g.contestId === id)?._count._all || 0;
      const end = e.contest.endDate ? new Date(e.contest.endDate).getTime() : null;
      e.daysLeft = end && end > now ? Math.ceil((end - now) / day) : null;
      e.finished = ['completed', 'archived', 'cancelled'].includes(e.contest.status);
    }
    res.render('pages/review/index', { title: 'Review — Zury', events, stats, recent: recent.map((r) => ({ ...r, path: eventPath(r.contest) })) });
  } catch (err) {
    next(err);
  }
}

// ── Assignments (organizers) ─────────────────────────────────────────────────

async function assignments(req, res, next) {
  try {
    res.render('pages/contest/assignments', {
      title: `Assignments — ${req.contest.title}`,
      overview: await reviewService.assignmentOverview({ contestId: req.contest.id, settings: req.eventSettings, wiki: req.wikiScope?.wiki }),
      assignedMode: reviewService.assignedMode(req.settings),
    });
  } catch (err) {
    next(err);
  }
}

function assignmentAction(fn) {
  return async (req, res, next) => {
    try {
      req.flash('success', await fn(req));
    } catch (err) {
      if (!(err instanceof ReviewError)) return next(err);
      req.flash('danger', err.message);
    }
    res.redirect(`${req.base}/assignments`);
  };
}

// Inside one wiki's page, an organizer works on that wiki's entries only.
async function entryInScope(req, submissionId) {
  const entry = await prisma.submission.findFirst({ where: { id: submissionId, contestId: req.contest.id }, select: { wiki: true } });
  if (!entry || (req.wikiScope && entry.wiki !== req.wikiScope.wiki)) throw new ReviewError('That entry is not part of this wiki.');
}

const distribute = assignmentAction(async (req) => {
  const { created, unfilled } = await reviewService.distribute({ actor: req.user, contest: req.contest, settings: req.eventSettings, wiki: req.wikiScope?.wiki });
  return unfilled
    ? req.t('{n} assignments made; {m} entries still need more reviewers.', { n: created, m: unfilled })
    : req.t('{n} assignments made.', { n: created });
});

// Entries of reviewers inactive for some days go to the others.
const reassignInactive = assignmentAction(async (req) => {
  const days = Math.max(1, Math.min(90, Number.parseInt(req.body.days, 10) || 7));
  const r = await reviewService.reassignInactive({ actor: req.user, contest: req.contest, settings: req.eventSettings, wiki: req.wikiScope?.wiki, days });
  if (!r.reviewers) return req.t('Every reviewer with entries has reviewed in the last {n} days.', { n: days });
  return req.t('{m} entries of {r} inactive reviewers were given to the others.', { m: r.moved, r: r.reviewers }) + (r.unfilled ? ' ' + req.t('{n} still need a reviewer.', { n: r.unfilled }) : '');
});

const addAssignment = assignmentAction(async (req) => {
  const submissionId = Number(req.body.submissionId);
  await entryInScope(req, submissionId);
  await reviewService.assign({ actor: req.user, contest: req.contest, settings: req.eventSettings, submissionId, jurorId: Number(req.body.jurorId) });
  return 'Assigned.';
});

const removeAssignment = assignmentAction(async (req) => {
  const a = await prisma.reviewAssignment.findFirst({ where: { id: Number(req.params.assignmentId), contestId: req.contest.id }, select: { submissionId: true } });
  if (a) await entryInScope(req, a.submissionId);
  await reviewService.unassign({ actor: req.user, contest: req.contest, assignmentId: Number(req.params.assignmentId) });
  return 'Assignment removed.';
});

const releaseJuror = assignmentAction(async (req) => {
  const n = await reviewService.releaseJuror({ actor: req.user, contest: req.contest, jurorId: Number(req.params.jurorId), wiki: req.wikiScope?.wiki });
  return req.t('{n} unreviewed entries taken back.', { n });
});

module.exports = { juryEventsFor, entries, bulkSave, assignments, distribute, reassignInactive, addAssignment, removeAssignment, releaseJuror, window, save, results, publish, appeal, appealsList, resolve, myQueue, judgedWikis };

// Higher levels clear an appeal from the log.
async function deleteAppeal(req, res, next) {
  try {
    await require('../config/prisma').appeal.deleteMany({ where: { id: Number(req.params.appealId), contestId: req.contest.id } });
    req.flash('success', req.t('Appeal deleted.'));
  } catch (err) {
    return next(err);
  }
  res.redirect(`${req.base}/appeals`);
}
module.exports.deleteAppeal = deleteAppeal;

async function handOver(req, res, next) {
  const id = Number(req.params.submissionId);
  try {
    await reviewService.handOver({ actor: req.user, contest: req.contest, settings: req.eventSettings, submissionId: id, toId: Number(req.body.to) });
    req.flash('success', req.t('Handed over; they have been told.'));
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', req.t(err.message));
  }
  res.redirect(`${req.base}/review?after=${id}`);
}
module.exports.handOver = handOver;

// The entry's article as content only (no wiki header, search or menus), styled like the wiki's articles.
async function previewPage(req, res, next) {
  try {
    const entry = await require('../config/prisma').submission.findFirst({ where: { id: Number(req.params.submissionId), contestId: req.contest.id } });
    if (!entry || !canJudge(req, entry)) return res.status(404).end();
    const host = dbnameToHost(entry.wiki);
    if (!host) return res.status(404).end();
    const q = new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', prop: 'text|displaytitle', disableeditsection: '1', disabletoc: '1', redirects: '1', ...(entry.revId && require('../services/participationService').read(req.settings).rules.revision !== 'latest' ? { oldid: String(entry.revId) } : { page: entry.title }) });
    const r = await fetch(`https://${host}/w/api.php?${q}`, { headers: { 'User-Agent': require('../config/env').userAgent } });
    const data = await r.json();
    const html = (data && data.parse ? data.parse.text : '<p>—</p>').replace(/(src|srcset|href)="\/\//g, '$1="https://').replace(/, \/\//g, ', https://');
    const styles = `https://${host}/w/load.php?lang=${encodeURIComponent(host.split('.')[0])}&modules=${encodeURIComponent('skins.vector.styles|ext.cite.styles|ext.tmh.player.styles|mediawiki.page.gallery.styles|wikibase.client.init')}&only=styles&skin=vector`;
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src https://${host} 'unsafe-inline'; img-src https: data:; media-src https:; font-src https:; frame-ancestors 'self'; base-uri https://${host}`);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.type('html').send(`<!doctype html><html lang="${host.split('.')[0]}"><head><meta charset="utf-8"><base href="https://${host}/wiki/" target="_blank"><link rel="stylesheet" href="${styles}"><link rel="stylesheet" href="https://${host}/w/load.php?lang=${encodeURIComponent(host.split('.')[0])}&modules=site.styles&only=styles&skin=vector"><style>body{margin:0;padding:12px 16px;font-family:sans-serif;background:#fff}.mw-parser-output{max-width:none}html{overflow-x:hidden}img{max-width:100%;height:auto}.mw-parser-output{overflow-x:auto}@media (max-width:700px){.infobox,.thumb,figure{float:none!important;max-width:100%!important;margin-left:auto!important;margin-right:auto!important}.mw-parser-output>table:not(.infobox){float:none!important;margin-left:0!important;margin-right:0!important}}.wikitable{background:#f8f9fa;color:#202122;margin:1em 0;border:1px solid #a2a9b1;border-collapse:collapse}.wikitable>*>tr>th,.wikitable>*>tr>td,.wikitable>tr>th,.wikitable>tr>td{border:1px solid #a2a9b1;padding:.2em .4em}.wikitable>*>tr>th,.wikitable>tr>th{background:#eaecf0;text-align:center;font-weight:bold}.wikitable>caption{font-weight:bold;padding:.2em .4em}h1.z-t{font-size:1.5rem;margin:0 0 .6rem;font-family:Georgia,serif;font-weight:normal;border-bottom:1px solid #eaecf0}</style></head><body class="skin-vector mediawiki"><div class="mw-body-content">${html}</div></body></html>`);
  } catch (err) {
    next(err);
  }
}
module.exports.previewPage = previewPage;
