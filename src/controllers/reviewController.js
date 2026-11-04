const prisma = require('../config/prisma');
const reviewService = require('../services/reviewService');
const { eventPath } = require('../utils/format');

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
    const q = await reviewService.queue({ contestId: req.contest.id, settings: req.eventSettings, jurorId: req.user.id, wikis, after });
    const id = Number(req.query.entry) || q.nextId;
    const entry = id ? await reviewService.entryForReview(req.contest.id, id) : null;
    if (entry && !canJudge(req, entry)) return res.status(404).render('pages/404', { title: 'Submission Not Found' });
    res.render('pages/contest/review', {
      title: `Review — ${req.contest.title}`,
      entry,
      meta: entry ? JSON.parse(entry.metadata || '{}') : null,
      validation: entry ? JSON.parse(entry.validation || '{}') : null,
      mine: entry ? entry.reviews.find((r) => r.jurorId === req.user.id) || null : null,
      others: entry ? entry.reviews.filter((r) => r.jurorId !== req.user.id) : [],
      scheme: reviewService.markScheme(req.eventSettings),
      required: Math.max(1, req.eventSettings.requiredReviews || 1),
      queue: q,
      progress: await reviewService.progress(req.contest.id, { wiki: req.wikiScope?.wiki }),
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
      comment: req.body.comment,
    });
    req.flash('success', result.decided ? 'Review saved; the entry is decided.' : 'Review saved.');
    res.redirect(`${req.base}/review?after=${id}`);
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', err.message);
    res.redirect(`${req.base}/review?entry=${id}`);
  }
}

// Results: public once published; organizers and jury see them before that.
async function results(req, res, next) {
  try {
    const insider = req.permissions.has('reviewEvent') || req.permissions.has('manageEvent');
    if (!req.contest.resultsPublishedAt && !insider) {
      const err = new Error('The results have not been published yet.');
      err.status = 403;
      return next(err);
    }
    res.render('pages/contest/results', {
      title: `Results — ${req.contest.title}`,
      rows: await reviewService.leaderboard({ contest: req.contest, settings: req.eventSettings, wiki: req.wikiScope?.wiki }),
      progress: insider ? await reviewService.progress(req.contest.id, { wiki: req.wikiScope?.wiki }) : null,
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
  res.redirect(`${req.base}/submissions/${id}`);
}

async function appealsList(req, res, next) {
  try {
    res.render('pages/contest/appeals', { title: `Appeals — ${req.contest.title}`, appeals: await reviewService.appeals(req.contest.id) });
  } catch (err) {
    next(err);
  }
}

async function resolve(req, res, next) {
  try {
    await reviewService.resolveAppeal({ actor: req.user, contest: req.contest, appealId: Number(req.params.appealId), action: req.params.action, response: req.body.response });
    req.flash('success', req.params.action === 'uphold' ? 'Appeal upheld; the entry goes back to the jury.' : 'Appeal dismissed.');
  } catch (err) {
    if (!(err instanceof ReviewError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(`${req.base}/appeals`);
}

// /review: every event where this person is on the jury, with what's waiting.
async function myQueue(req, res, next) {
  try {
    const memberships = await prisma.contestMembership.findMany({
      where: { userId: req.user.id, role: 'jury', status: 'active', contest: { deletedAt: null } },
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
      const q = await reviewService.queue({ contestId: contest.id, settings: contest.settings || {}, jurorId: req.user.id, wikis: all });
      events.push({ contest, path: eventPath(contest), remaining: q.remaining, reviewed: q.reviewedByMe, wikis: all });
    }
    events.sort((a, b) => b.remaining - a.remaining);
    res.render('pages/review/index', { title: 'Review — Zury', events });
  } catch (err) {
    next(err);
  }
}

module.exports = { window, save, results, publish, appeal, appealsList, resolve, myQueue, judgedWikis };
