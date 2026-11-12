// Jury review: each jury member gives an entry a decision (accept or reject)
// and the event's marks. Once an entry has the reviews it needs, the majority
// decides, and its score is the average of the points. Also results and appeals.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const notifications = require('./notificationService');
const pathOf = (contest) => contest.path || `/contest/${contest.id}`;
const { readTypeConfig } = require('../events/eventTypes');

// Entries the jury can still decide on.
const REVIEWABLE = ['pending', 'validated', 'under_review'];
const DECISIONS = ['accept', 'reject'];

class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function markScheme(settings) {
  if (settings.reviewMethod && settings.reviewMethod !== 'marks') return [];
  try {
    const marks = JSON.parse(settings.marks || '[]');
    return Array.isArray(marks) ? marks : [];
  } catch {
    return [];
  }
}

// { name: label } → total points; every mark must have one of its values.
function scoreMarks(scheme, chosen) {
  let points = 0;
  const clean = {};
  for (const mark of scheme) {
    const label = chosen?.[mark.name];
    const value = mark.values.find((v) => v.label === label);
    if (!value) throw new ReviewError(`Choose a value for “${mark.name}”.`);
    clean[mark.name] = value.label;
    points += value.points;
  }
  return { marks: clean, points };
}

const METHODS = ['yesno', 'stars', 'number', 'marks'];

// A review's verdict and points by the event's method: yes/no (1/0), stars (1–5), a number
// (in the range when there is one), or the custom marks. With a score, the verdict follows the
// pass mark, and the entry is decided by the average (decisionRule "score").
function verdict(settings, { decision, marks, score }) {
  const method = METHODS.includes(settings.reviewMethod) ? settings.reviewMethod : 'marks';
  const pass = Number(settings.passScore) || 0;
  if (method === 'stars' || method === 'number') {
    const n = Number(score);
    if (score === undefined || score === null || String(score).trim() === '' || !Number.isFinite(n)) throw new ReviewError('Give a score.');
    if (method === 'stars' && (!Number.isInteger(n) || n < 1 || n > 5)) throw new ReviewError('Give one to five stars.');
    if (method === 'number' && ((settings.scoreMin != null && n < settings.scoreMin) || (settings.scoreMax != null && n > settings.scoreMax))) {
      throw new ReviewError('The score is outside the allowed range.');
    }
    return { decision: n >= pass ? 'accept' : 'reject', marks: {}, points: n };
  }
  if (!DECISIONS.includes(decision)) throw new ReviewError('Choose accept or reject.');
  if (method === 'yesno') return { decision, marks: {}, points: decision === 'accept' ? 1 : 0 };
  return { decision, ...scoreMarks(markScheme(settings), marks) };
}

/**
 * The next entry for a jury member. wikis: the wikis they may judge (null = all).
 * after: skip entries up to this id (the "skip" button).
 */
// Reviewers see only the entries given to them: assigned by hand, shared out equally, or a set number each.
const assignedMode = (settings) => ['assigned', 'equal', 'fixed'].includes(settings.reviewAssignment);

const DECISION_RULES = ['majority', 'unanimous', 'any', 'veto', 'first', 'last', 'score'];

/**
 * What the reviews so far make of an entry ({ status, score }), by the event's rule.
 * Reviews come oldest first. Until enough reviews are in, it stays under review, except with
 * "first", where the first review decides, and "veto", where one reject is enough.
 */
function decide(reviews, settings) {
  const required = Math.max(1, settings.requiredReviews || 1);
  const rule = ['stars', 'number'].includes(settings.reviewMethod) ? 'score' : DECISION_RULES.includes(settings.decisionRule) ? settings.decisionRule : 'majority';
  const score = reviews.length ? Math.round((reviews.reduce((n, r) => n + (r.points || 0), 0) / reviews.length) * 100) / 100 : null;
  const accepts = reviews.filter((r) => r.decision === 'accept').length;
  const rejects = reviews.filter((r) => r.decision === 'reject').length;
  const waiting = { status: 'under_review', score: null };
  if (!reviews.length) return waiting;
  if (rule === 'first') return { status: reviews[0].decision === 'accept' ? 'approved' : 'rejected', score };
  // The last review decides (once enough reviews are in).
  if (rule === 'last' && reviews.length >= required) {
    const last = [...reviews].sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0)).pop();
    return { status: last.decision === 'accept' ? 'approved' : 'rejected', score };
  }
  if (rule === 'veto' && rejects) return { status: 'rejected', score };
  if (reviews.length < required) return waiting;
  switch (rule) {
    case 'unanimous':
      return { status: rejects ? 'rejected' : 'approved', score };
    case 'any':
      return { status: accepts ? 'approved' : 'rejected', score };
    case 'veto':
      return { status: 'approved', score };
    case 'score':
      return { status: score >= (Number(settings.passScore) || 0) ? 'approved' : 'rejected', score };
    default: {
      if (accepts * 2 > reviews.length) return { status: 'approved', score };
      if (rejects * 2 > reviews.length) return { status: 'rejected', score };
      // A tie.
      if (settings.tieBreak === 'accept') return { status: 'approved', score };
      if (settings.tieBreak === 'wait') return waiting;
      return { status: 'rejected', score };
    }
  }
}

/**
 * The entries a jury member works through, oldest first, and where they are.
 * filters: mode "waiting" (not yet reviewed by them, still needing reviews; the default),
 * "open" (everything not yet decided) or "mine" (what they reviewed, to correct it);
 * participantId, q (title), minWords, wiki (one of theirs).
 */
async function queue({ contestId, settings, jurorId, wikis = null, after = 0, filters = {} }) {
  const required = Math.max(1, settings.requiredReviews || 1);
  const mode = ['open', 'mine'].includes(filters.mode) ? filters.mode : 'waiting';
  const onWikis = filters.wiki && (!wikis || wikis.includes(filters.wiki)) ? [filters.wiki] : wikis;
  const where = {
    contestId,
    ...(onWikis && { wiki: { in: onWikis } }),
    ...(mode === 'mine' ? { reviews: { some: { jurorId } } } : { status: { in: REVIEWABLE } }),
    ...(mode === 'waiting' && { reviews: { none: { jurorId } } }),
    ...(mode !== 'mine' && assignedMode(settings) && { assignments: { some: { jurorId } } }),
    ...(filters.participantId && { participantId: filters.participantId }),
    ...(filters.q && { title: { contains: filters.q } }),
    ...((filters.minWords || filters.maxWords) && { wordCount: { ...(filters.minWords && { gte: filters.minWords }), ...(filters.maxWords && { lte: filters.maxWords }) } }),
    ...((filters.from || filters.to) && { submittedAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } }),
    ...(filters.status && { status: filters.status }),
    ...(filters.reviews === 'none' && { reviews: { none: {} } }),
    ...(filters.reviews === 'some' && { reviews: { some: {} } }),
    ...(filters.checks === 'warnings' && { validation: { contains: '"warnings":["' } }),
    ...(!settings.selfReview && { NOT: { participantId: jurorId } }),
  };
  const order = QUEUE_SORTS[filters.sort] || QUEUE_SORTS.oldest;
  const candidates = await prisma.submission.findMany({ where, orderBy: [...order, { id: 'asc' }], select: { id: true } });
  // Entries that already have all their reviews are waiting to be decided, not for this person.
  // Counted apart (counting inside the query above is slow on big events).
  let list = candidates;
  if (mode === 'waiting' && candidates.length) {
    const full = new Set();
    for (let i = 0; i < candidates.length; i += 5000) {
      const ids = candidates.slice(i, i + 5000).map((c) => c.id);
      const counts = await prisma.review.groupBy({ by: ['submissionId'], where: { submissionId: { in: ids } }, _count: { _all: true } });
      for (const r of counts) if (r._count._all >= required) full.add(r.submissionId);
    }
    list = candidates.filter((c) => !full.has(c.id));
  }
  // The next one is the one after "after" in this order (from the start once past the end).
  const from = after ? list.findIndex((c) => c.id === after) : -1;
  const next = (from >= 0 ? list[from + 1] : null) || (from >= 0 ? list.find((c) => c.id !== after) : list[0]) || null;
  const reviewedByMe = await prisma.review.count({ where: { contestId, jurorId } });
  return { nextId: next ? next.id : null, remaining: list.length, reviewedByMe, mode, ids: list.map((c) => c.id) };
}

// One page of the queue (in its order) for the entry picker, optionally searched by title.
async function queuePage({ ids, q = '', page = 1, perPage = 30 }) {
  let pool = ids;
  if (q) {
    const hits = await prisma.submission.findMany({ where: { id: { in: ids }, title: { contains: q } }, select: { id: true } });
    const set = new Set(hits.map((h) => h.id));
    pool = ids.filter((id) => set.has(id));
  }
  const slice = pool.slice((page - 1) * perPage, page * perPage);
  const rows = await prisma.submission.findMany({ where: { id: { in: slice } }, select: { id: true, title: true, wordCount: true, status: true, participant: { select: { username: true } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { items: slice.map((id) => byId.get(id)).filter(Boolean).map((r) => ({ ...r, position: ids.indexOf(r.id) + 1 })), total: pool.length, more: page * perPage < pool.length };
}

// Orders of the review queue.
const QUEUE_SORTS = {
  oldest: [{ submittedAt: 'asc' }],
  newest: [{ submittedAt: 'desc' }],
  'words-desc': [{ wordCount: { sort: 'desc', nulls: 'last' } }],
  'words-asc': [{ wordCount: { sort: 'asc', nulls: 'last' } }],
  title: [{ title: 'asc' }],
};

// Each jury member's work: reviews, accepted and rejected, and when they last reviewed.
async function juryActivity(contestId, { wiki } = {}) {
  const where = { contestId, ...(wiki && { submission: { wiki } }) };
  const { Prisma } = require('@prisma/client');
  const [byDecision, last, agreeRows] = await Promise.all([
    prisma.review.groupBy({ by: ['jurorId', 'decision'], where, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['jurorId'], where, _max: { updatedAt: true } }),
    // Agreement: on decided entries that had at least two reviews, how often the reviewer's
    // verdict matched the decision.
    prisma.$queryRaw`
      SELECT r.jurorId AS jurorId, COUNT(*) AS n,
             SUM((r.decision = 'accept' AND s.status = 'approved') OR (r.decision = 'reject' AND s.status = 'rejected')) AS agree
      FROM Review r JOIN Submission s ON s.id = r.submissionId
      WHERE r.contestId = ${contestId} ${wiki ? Prisma.sql`AND s.wiki = ${wiki}` : Prisma.empty}
        AND s.status IN ('approved', 'rejected')
        AND (SELECT COUNT(*) FROM Review r2 WHERE r2.submissionId = r.submissionId) >= 2
      GROUP BY r.jurorId`,
  ]);
  const agreement = new Map(agreeRows.map((a) => [Number(a.jurorId), { n: Number(a.n), pct: Number(a.n) ? Math.round((Number(a.agree) / Number(a.n)) * 100) : null }]));
  const users = await prisma.user.findMany({ where: { id: { in: last.map((r) => r.jurorId) } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const rows = last.map((r) => {
    const of = (d) => byDecision.find((x) => x.jurorId === r.jurorId && x.decision === d)?._count._all || 0;
    const ag = agreement.get(r.jurorId);
    return { id: r.jurorId, username: name[r.jurorId], accepted: of('accept'), rejected: of('reject'), reviews: of('accept') + of('reject'), lastAt: r._max.updatedAt, agreement: ag ? ag.pct : null, agreementOf: ag ? ag.n : 0 };
  });
  const most = Math.max(1, ...rows.map((r) => r.reviews));
  return rows.sort((x, y) => y.reviews - x.reviews).map((r) => ({ ...r, share: Math.round((r.reviews / most) * 100) }));
}

async function entryForReview(contestId, submissionId) {
  return prisma.submission.findFirst({
    where: { id: submissionId, contestId },
    include: {
      participant: { select: { id: true, username: true } },
      submittedBy: { select: { id: true, username: true } },
      reviews: { include: { juror: { select: { username: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
}

/**
 * Saves (or updates) one jury member's review, then decides the entry once it
 * has enough reviews. Returns { status, decided }.
 */
async function saveReview({ actor, contest, settings, submission, decision, marks, score, comment, notify = 'auto', note = '' }) {
  const given = verdict(settings, { decision, marks, score });
  decision = given.decision;
  if (decision === 'reject' && !String(comment || '').trim()) throw new ReviewError('Give a reason to reject.');
  if (!REVIEWABLE.includes(submission.status) && !submission.reviews.some((r) => r.jurorId === actor.id)) {
    throw new ReviewError('This entry has already been decided.');
  }
  if (submission.participantId === actor.id && !settings.selfReview) throw new ReviewError("You can't review your own entry.", 403);
  if (assignedMode(settings) && !submission.reviews.some((r) => r.jurorId === actor.id)) {
    const assigned = await prisma.reviewAssignment.count({ where: { submissionId: submission.id, jurorId: actor.id } });
    if (!assigned) throw new ReviewError('This entry is not assigned to you.', 403);
  }
  const maxReviews = require('./participationService').read(settings).rules.maxReviews;
  if (maxReviews && !submission.reviews.some((r) => r.jurorId === actor.id) && submission.reviews.length >= maxReviews) {
    throw new ReviewError('This entry already has all the reviews it takes.');
  }
  const scored = given;
  const required = Math.max(1, settings.requiredReviews || 1);

  return prisma.$transaction(async (tx) => {
    const data = { decision, marks: JSON.stringify(scored.marks), points: scored.points, comment: String(comment || '').trim().slice(0, 2000) };
    await tx.review.upsert({
      where: { submissionId_jurorId: { submissionId: submission.id, jurorId: actor.id } },
      update: data,
      create: { ...data, contestId: contest.id, submissionId: submission.id, jurorId: actor.id },
    });
    const reviews = await tx.review.findMany({ where: { submissionId: submission.id }, orderBy: { createdAt: 'asc' } });
    const { status, score } = decide(reviews, settings);
    if (status !== submission.status || score !== submission.score) {
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status,
          score,
          ...(status !== submission.status && {
            history: { create: { actorId: actor.id, action: 'reviewed', previousValue: submission.status, newValue: status, note: `${reviews.length}/${required}` } },
          }),
        },
      });
    }
    // The participant hears when their entry is decided (if the event notifies participants).
    // Not accepted: the bell rings by itself. Otherwise the reviewer chooses (bell, on-wiki message or nothing).
    const ring = notify === 'bell' || notify === 'onwiki' || (notify === 'auto' && status === 'rejected');
    if (ring && status !== submission.status && ['approved', 'rejected'].includes(status) && settings.participantNotificationsEnabled !== false && submission.participantId !== actor.id) {
      await notifications.notify(submission.participantId, {
        kind: 'entry.decided',
        message: note || (status === 'approved' ? 'Your entry “{title}” in {event} was accepted.' : 'Your entry “{title}” in {event} was not accepted.'),
        params: { title: submission.title, event: contest.title },
        link: `${pathOf(contest)}/submissions?mine=1`,
        contestId: contest.id,
      }, tx);
    }
    // No activity-log row per review: the review and the entry's history already record it,
    // and big events have hundreds of thousands of them.
    return { status, decided: status !== 'under_review' };
  });
}

// Review progress: totals and each jury member's count.
async function progress(contestId, { wiki } = {}) {
  const where = { contestId, ...(wiki && { wiki }) };
  const [byStatus, byJuror] = await Promise.all([
    prisma.submission.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['jurorId'], where: { contestId, ...(wiki && { submission: { wiki } }) }, _count: { _all: true } }),
  ]);
  const count = (statuses) => byStatus.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  const users = await prisma.user.findMany({ where: { id: { in: byJuror.map((r) => r.jurorId) } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  return {
    waiting: count(REVIEWABLE),
    decided: count(['approved', 'rejected']),
    approved: count(['approved']),
    rejected: count(['rejected']),
    jurors: byJuror.map((r) => ({ username: name[r.jurorId], reviews: r._count._all })).sort((a, b) => b.reviews - a.reviews),
  };
}

/**
 * Ranking of participants. With a jury: approved entries and their scores
 * (1 point each when there are no marks). Proofread-a-thons: points per page
 * level. Otherwise: entries that passed the checks.
 */
async function leaderboard({ contest, settings, wiki }) {
  const where = { contestId: contest.id, ...(wiki && { wiki }) };
  const typeConfig = readTypeConfig(contest.type, settings.typeConfig);
  // What the results count: words, articles, or points (the reviewers' scores or marks).
  let byWords = settings.rankBy ? ['words', 'both'].includes(settings.rankBy) : !!settings.wordCountEnabled;
  let entries;
  let pointsOf;
  if (contest.type === 'proofread') {
    entries = await prisma.submission.findMany({ where: { ...where, status: { in: ['validated', 'approved'] } }, select: { participantId: true, metadata: true, wordCount: true } });
    pointsOf = (e) => {
      const level = JSON.parse(e.metadata || '{}').proofread?.level;
      return level >= 4 ? typeConfig.pointsValidated : level === 3 ? typeConfig.pointsProofread : 0;
    };
  }
  const rows = new Map();
  if (entries) {
    for (const e of entries) {
      const row = rows.get(e.participantId) || { participantId: e.participantId, entries: 0, points: 0, words: 0 };
      row.entries += 1;
      row.points += pointsOf(e);
      row.words += e.wordCount || 0;
      rows.set(e.participantId, row);
    }
  } else {
    // Added up by the database, one row per person: fast with 100,000+ entries.
    // Everyone who submitted is listed; points and words come from the accepted entries.
    const jury = settings.juryReviewEnabled;
    const byPoints = jury && (settings.rankBy ? settings.rankBy === 'points' : markScheme(settings).length > 0);
    const [all, counted] = await Promise.all([
      prisma.submission.groupBy({ by: ['participantId'], where: { ...where, status: { notIn: ['withdrawn'] } }, _count: { _all: true } }),
      prisma.submission.groupBy({
        by: ['participantId'],
        where: { ...where, status: jury ? 'approved' : { in: ['validated', 'approved'] } },
        _count: { _all: true },
        _sum: { score: true, wordCount: true },
      }),
    ]);
    for (const g of all) rows.set(g.participantId, { participantId: g.participantId, submitted: g._count._all, entries: 0, points: 0, words: 0 });
    for (const g of counted) {
      const row = rows.get(g.participantId) || { participantId: g.participantId, submitted: g._count._all };
      rows.set(g.participantId, { ...row, entries: g._count._all, points: byPoints ? g._sum.score || 0 : g._count._all, words: g._sum.wordCount || 0 });
    }
  }
  // Ranking by words only means something when the entries have word counts.
  if (byWords && ![...rows.values()].some((r) => r.words > 0)) byWords = false;
  const users = await prisma.user.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, points: Math.round(r.points * 100) / 100, username: name[r.participantId] }))
    .sort((a, b) => (byWords ? b.words - a.words : 0) || b.points - a.points || b.entries - a.entries || a.username.localeCompare(b.username));
  // Equal scores share a rank.
  const key = (r) => (byWords ? r.words : r.points);
  let rank = 0;
  const ranked = sorted.map((r, i) => {
    if (i === 0 || key(r) !== key(sorted[i - 1])) rank = i + 1;
    return { ...r, rank };
  });
  ranked.byWords = byWords;
  return ranked;
}

async function setResultsPublished({ actor, contest, published }) {
  await prisma.contest.update({ where: { id: contest.id }, data: { resultsPublishedAt: published ? new Date() : null } });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: published ? 'results.published' : 'results.unpublished', entityType: 'Contest', entityId: contest.id, details: { title: contest.title } });
}

// ── Assignments ────────────────────────────────────────────────────────────

// Jury members who may review entries from this wiki: event-wide jury and that wiki's jury.
// Who may review a wiki's entries, by the event's choice of reviewers: its jury, the wiki's
// local admins (signed in to Zury, rights checked in the last week), and/or its participants.
async function jurorsFor(contestId, wiki, settings = null) {
  let who = ['jury'];
  try {
    if (settings && settings.reviewers) who = JSON.parse(settings.reviewers);
  } catch {
    /* the jury */
  }
  const notBlocked = { eventBlocks: { none: { contestId, liftedAt: null } } };
  const ids = [];
  const roles = [...(who.includes('jury') ? ['jury'] : []), ...(who.includes('participants') ? ['participant'] : [])];
  if (roles.length) {
    const rows = await prisma.contestMembership.findMany({
      where: { contestId, role: { in: roles }, status: 'active', OR: [{ role: 'participant' }, { wiki: { in: ['', wiki] } }], user: notBlocked },
      select: { userId: true },
    });
    ids.push(...rows.map((r) => r.userId));
  }
  if (who.includes('localAdmins')) {
    const { RIGHTS_MAX_AGE_MS } = require('./permissionService');
    const admins = await prisma.userWikiRole.findMany({
      where: { wiki, rightName: 'sysop', verifiedAt: { gte: new Date(Date.now() - RIGHTS_MAX_AGE_MS) }, user: { status: 'active', ...notBlocked } },
      select: { userId: true },
    });
    ids.push(...admins.map((r) => r.userId));
  }
  return [...new Set(ids)];
}

/**
 * Gives every entry still waiting for the jury as many jury members as it
 * needs reviews, picking the least busy each time and never the entry's own
 * author. Existing assignments are kept. Returns { created, unfilled }.
 */
// ids: only these entries (new ones, when shared out automatically). actor: null when automatic.
// With "a set number each", nobody gets more than assignPerJuror.
async function distribute({ actor, contest, settings, wiki, ids = null, exclude = [] }) {
  const required = Math.max(1, settings.requiredReviews || 1);
  const cap = settings.reviewAssignment === 'fixed' && settings.assignPerJuror > 0 ? settings.assignPerJuror : Infinity;
  const entries = await prisma.submission.findMany({
    where: { contestId: contest.id, status: { in: REVIEWABLE }, ...(wiki && { wiki }), ...(ids && { id: { in: ids } }) },
    orderBy: { id: 'asc' },
    select: { id: true, wiki: true, participantId: true, assignments: { select: { jurorId: true } }, reviews: { select: { jurorId: true } } },
  });
  const loads = new Map(
    (await prisma.reviewAssignment.groupBy({ by: ['jurorId'], where: { contestId: contest.id }, _count: { _all: true } })).map((r) => [r.jurorId, r._count._all]),
  );
  const jurorCache = new Map();
  const data = [];
  let unfilled = 0;
  for (const e of entries) {
    if (!jurorCache.has(e.wiki)) jurorCache.set(e.wiki, await jurorsFor(contest.id, e.wiki, settings));
    const taken = new Set([...e.assignments.map((a) => a.jurorId), ...e.reviews.map((r) => r.jurorId)]);
    let missing = required - taken.size;
    const pool = jurorCache.get(e.wiki).filter((id) => id !== e.participantId && !taken.has(id) && !exclude.includes(id) && (loads.get(id) || 0) < cap);
    while (missing > 0 && pool.length) {
      pool.sort((a, b) => (loads.get(a) || 0) - (loads.get(b) || 0) || a - b);
      const jurorId = pool.shift();
      data.push({ contestId: contest.id, submissionId: e.id, jurorId, assignedById: actor ? actor.id : null });
      loads.set(jurorId, (loads.get(jurorId) || 0) + 1);
      missing -= 1;
    }
    if (missing > 0) unfilled += 1;
  }
  if (data.length) await prisma.reviewAssignment.createMany({ data });
  // Each juror hears once how many entries came their way.
  const perJuror = new Map();
  for (const d of data) perJuror.set(d.jurorId, (perJuror.get(d.jurorId) || 0) + 1);
  for (const [jurorId, n] of perJuror) {
    if (!actor || jurorId !== actor.id) await notifications.notify(jurorId, { kind: 'review.assigned', message: 'You have {n} new entries to review in {event}.', params: { n, event: contest.title }, link: `${pathOf(contest)}/review`, contestId: contest.id });
  }
  if (data.length || !ids) await audit.record({ actorId: actor ? actor.id : null, contestId: contest.id, action: 'assignments.distributed', entityType: 'Contest', entityId: contest.id, details: { created: data.length, unfilled, wiki: wiki || undefined, automatic: !actor || undefined } });
  return { created: data.length, unfilled };
}

// New entries go to reviewers right away when the event shares them out automatically.
async function autoAssign({ contest, settings, ids }) {
  if (!ids.length || !settings.juryReviewEnabled || !['equal', 'fixed'].includes(settings.reviewAssignment)) return null;
  return distribute({ actor: null, contest, settings, wiki: null, ids });
}

// Reviewers who haven't reviewed here for `days` days (or never, having had entries that long)
// give back the entries they haven't reviewed; those go to the active reviewers, in the usual
// way (least busy first, never someone's own entry). Returns { reviewers, moved, unfilled }.
async function reassignInactive({ actor, contest, settings, wiki = null, days = 7 }) {
  const since = new Date(Date.now() - Math.max(1, days) * 864e5);
  const open = await prisma.reviewAssignment.findMany({
    where: { contestId: contest.id, submission: { status: { in: REVIEWABLE }, ...(wiki && { wiki }) } },
    select: { id: true, jurorId: true, submissionId: true, createdAt: true, submission: { select: { reviews: { select: { jurorId: true } } } } },
  });
  const pending = open.filter((a) => !a.submission.reviews.some((r) => r.jurorId === a.jurorId));
  const last = new Map((await prisma.review.groupBy({ by: ['jurorId'], where: { contestId: contest.id }, _max: { updatedAt: true } })).map((r) => [r.jurorId, r._max.updatedAt]));
  const inactive = new Set(pending.filter((a) => { const l = last.get(a.jurorId); return l ? l < since : a.createdAt < since; }).map((a) => a.jurorId));
  if (!inactive.size) return { reviewers: 0, moved: 0, unfilled: 0 };
  const taken = pending.filter((a) => inactive.has(a.jurorId));
  await prisma.reviewAssignment.deleteMany({ where: { id: { in: taken.map((a) => a.id) } } });
  const ids = [...new Set(taken.map((a) => a.submissionId))];
  const { created, unfilled } = await distribute({ actor, contest, settings, wiki, ids, exclude: [...inactive] });
  await audit.record({ actorId: actor ? actor.id : null, contestId: contest.id, action: 'assignments.reassigned', entityType: 'Contest', entityId: contest.id, details: { days, reviewers: [...inactive], taken: taken.length, created, unfilled } });
  return { reviewers: inactive.size, moved: taken.length, unfilled };
}

async function assign({ actor, contest, settings = null, submissionId, jurorId }) {
  const entry = await prisma.submission.findFirst({ where: { id: submissionId, contestId: contest.id } });
  if (!entry) throw new ReviewError('That entry no longer exists.');
  if (entry.participantId === jurorId) throw new ReviewError("Reviewers can't review their own entries.");
  if (!(await jurorsFor(contest.id, entry.wiki, settings)).includes(jurorId)) throw new ReviewError('This person is not on the reviewers for this wiki.');
  await prisma.reviewAssignment.upsert({
    where: { submissionId_jurorId: { submissionId, jurorId } },
    update: {},
    create: { contestId: contest.id, submissionId, jurorId, assignedById: actor.id },
  });
  if (jurorId !== actor.id) await notifications.notify(jurorId, { kind: 'review.assigned', message: 'You have a new entry to review in {event}.', params: { event: contest.title }, link: `${pathOf(contest)}/review`, contestId: contest.id });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'assignment.added', entityType: 'Submission', entityId: submissionId, details: { title: entry.title, jurorId } });
}

// Unreviewed assignments only: a review already given stays.
async function unassign({ actor, contest, assignmentId }) {
  const a = await prisma.reviewAssignment.findFirst({ where: { id: assignmentId, contestId: contest.id }, include: { submission: { select: { title: true } } } });
  if (!a) throw new ReviewError('That assignment no longer exists.');
  await prisma.reviewAssignment.delete({ where: { id: a.id } });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'assignment.removed', entityType: 'Submission', entityId: a.submissionId, details: { title: a.submission.title, jurorId: a.jurorId } });
}

// Takes back everything a jury member hasn't reviewed yet (e.g. when they step down).
async function releaseJuror({ actor, contest, jurorId, wiki }) {
  const open = await prisma.reviewAssignment.findMany({
    where: { contestId: contest.id, jurorId, submission: { reviews: { none: { jurorId } }, ...(wiki && { wiki }) } },
    select: { id: true },
  });
  if (open.length) await prisma.reviewAssignment.deleteMany({ where: { id: { in: open.map((a) => a.id) } } });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'assignments.released', entityType: 'User', entityId: jurorId, details: { count: open.length } });
  return open.length;
}

/**
 * For the assignments page: each jury member's load, and the entries still
 * waiting with who has them. wiki limits both to one wiki.
 */
async function assignmentOverview({ contestId, settings, wiki }) {
  const required = Math.max(1, settings.requiredReviews || 1);
  // The reviewers, by the event's choice (jury, local admins, participants), with the wikis they review.
  const wikiList = wiki ? [wiki] : (await prisma.contestWiki.findMany({ where: { contestId, status: { not: 'pending' } }, select: { wiki: true } })).map((w) => w.wiki);
  const pool = new Map();
  for (const w of wikiList) for (const id of await jurorsFor(contestId, w, settings)) pool.set(id, [...(pool.get(id) || []), w]);
  const people = await prisma.user.findMany({ where: { id: { in: [...pool.keys()] } }, select: { id: true, username: true } });
  const lastReview = new Map((await prisma.review.groupBy({ by: ['jurorId'], where: { contestId }, _max: { updatedAt: true } })).map((r) => [r.jurorId, r._max.updatedAt]));
  const jurors = new Map(people.map((u) => [u.id, { id: u.id, username: u.username, wikis: pool.get(u.id).length === wikiList.length && wikiList.length > 1 ? [''] : pool.get(u.id), assigned: 0, reviewed: 0, lastAt: lastReview.get(u.id) || null }]));
  const assignments = await prisma.reviewAssignment.findMany({
    where: { contestId, ...(wiki && { submission: { wiki } }) },
    select: { id: true, jurorId: true, submissionId: true, submission: { select: { reviews: { select: { jurorId: true } } } } },
  });
  for (const a of assignments) {
    const j = jurors.get(a.jurorId);
    if (!j) continue;
    j.assigned += 1;
    if (a.submission.reviews.some((r) => r.jurorId === a.jurorId)) j.reviewed += 1;
  }
  const entries = await prisma.submission.findMany({
    where: { contestId, status: { in: REVIEWABLE }, ...(wiki && { wiki }) },
    orderBy: { id: 'asc' },
    take: 300,
    select: {
      id: true, title: true, wiki: true, participant: { select: { username: true } },
      assignments: { select: { id: true, jurorId: true, juror: { select: { username: true } } } },
      reviews: { select: { jurorId: true } },
    },
  });
  // Every waiting entry with fewer reviewers than it needs (the list above shows the first 300).
  const { Prisma } = require('@prisma/client');
  const [{ n }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM Submission s
    WHERE s.contestId = ${contestId} AND s.status IN (${Prisma.join(REVIEWABLE)}) ${wiki ? Prisma.sql`AND s.wiki = ${wiki}` : Prisma.empty}
      AND (SELECT COUNT(*) FROM ReviewAssignment a WHERE a.submissionId = s.id) < ${required}`;
  const unassigned = Number(n);
  return {
    required,
    jurors: [...jurors.values()].map((j) => ({ ...j, remaining: j.assigned - j.reviewed })).sort((a, b) => a.username.localeCompare(b.username)),
    entries: entries.map((e) => ({
      ...e,
      assignees: e.assignments.map((a) => ({ id: a.id, jurorId: a.jurorId, username: a.juror.username, done: e.reviews.some((r) => r.jurorId === a.jurorId) })),
    })),
    unassigned,
  };
}

// ── Appeals ────────────────────────────────────────────────────────────────

const APPEALABLE = ['rejected', 'disqualified'];

function canAppeal({ submission, contest, settings, user, now = new Date() }) {
  if (!user || submission.participantId !== user.id) return false;
  if (!settings.appealsEnabled || !APPEALABLE.includes(submission.status)) return false;
  const appealRule = require('./participationService').read(settings).rules.appeals;
  if (appealRule === 'off' || (appealRule === 'rejected' && submission.status !== 'rejected')) return false;
  return !contest.appealDeadline || now <= contest.appealDeadline;
}

async function createAppeal({ user, contest, settings, submission, reason }) {
  if (!canAppeal({ submission, contest, settings, user })) throw new ReviewError('This entry cannot be appealed.');
  reason = String(reason || '').trim();
  if (reason.length < 10 || reason.length > 2000) throw new ReviewError('Explain the appeal in 10 to 2000 characters.');
  const maxAppeals = require('./participationService').read(settings).rules.maxAppeals || 1;
  if ((await prisma.appeal.count({ where: { submissionId: submission.id } })) >= maxAppeals) throw new ReviewError('This entry cannot be appealed again.');
  // The page as it is now replaces the submitted revision.
  await require('./submissionService').repin(submission).catch(() => null);
  return prisma.$transaction(async (tx) => {
    const appeal = await tx.appeal.create({ data: { contestId: contest.id, submissionId: submission.id, userId: user.id, reason } });
    await tx.submission.update({
      where: { id: submission.id },
      data: { status: 'appealed', history: { create: { actorId: user.id, action: 'appealed', previousValue: submission.status, newValue: 'appealed', note: reason.slice(0, 500) } } },
    });
    await audit.record({ actorId: user.id, contestId: contest.id, action: 'appeal.created', entityType: 'Submission', entityId: submission.id, details: { title: submission.title } }, tx);
    const judges = await tx.review.findMany({ where: { submissionId: submission.id }, select: { jurorId: true } });
    for (const id of new Set(judges.map((j) => j.jurorId))) {
      await notifications.notify(id, { kind: 'appeal.created', message: 'An entry you reviewed, “{title}” in {event}, was appealed.', params: { title: submission.title, event: contest.title }, link: `${pathOf(contest)}/appeals`, contestId: contest.id }, tx);
    }
    return appeal;
  });
}

// upheld: the entry goes back to the jury; dismissed: the earlier decision stands.
async function resolveAppeal({ actor, contest, appealId, action, response }) {
  if (!['uphold', 'dismiss'].includes(action)) throw new ReviewError('Unknown action.');
  return prisma.$transaction(async (tx) => {
    const appeal = await tx.appeal.findFirst({ where: { id: appealId, contestId: contest.id, status: 'open' }, include: { submission: true } });
    if (!appeal) throw new ReviewError('That appeal is already closed.');
    const upheld = action === 'uphold';
    const history = await tx.submissionHistory.findFirst({ where: { submissionId: appeal.submissionId, action: 'appealed' }, orderBy: { id: 'desc' } });
    const previous = history?.previousValue || 'rejected';
    await tx.appeal.update({ where: { id: appeal.id }, data: { status: upheld ? 'upheld' : 'dismissed', response: String(response || '').trim().slice(0, 2000), resolvedById: actor.id, resolvedAt: new Date() } });
    if (upheld) await tx.review.deleteMany({ where: { submissionId: appeal.submissionId } });
    const status = upheld ? 'under_review' : previous;
    await tx.submission.update({
      where: { id: appeal.submissionId },
      data: { status, score: upheld ? null : appeal.submission.score, history: { create: { actorId: actor.id, action: upheld ? 'appeal_upheld' : 'appeal_dismissed', previousValue: 'appealed', newValue: status } } },
    });
    await notifications.notify(appeal.submission.participantId, {
      kind: 'appeal.resolved',
      message: upheld ? 'Your appeal for “{title}” was upheld: the entry will be reviewed again.' : 'Your appeal for “{title}” was dismissed.',
      params: { title: appeal.submission.title },
      link: `${pathOf(contest)}/submissions/${appeal.submissionId}`,
      contestId: contest.id,
    }, tx);
    await audit.record({ actorId: actor.id, contestId: contest.id, action: `appeal.${upheld ? 'upheld' : 'dismissed'}`, entityType: 'Submission', entityId: appeal.submissionId, details: { title: appeal.submission.title } }, tx);
  });
}

function appeals(contestId) {
  return prisma.appeal.findMany({
    where: { contestId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { submission: { select: { id: true, title: true, url: true, wiki: true, status: true, wordCount: true, reviews: { select: { decision: true, comment: true, juror: { select: { username: true } } }, orderBy: { createdAt: 'asc' } } } }, user: { select: { username: true } }, resolvedBy: { select: { username: true } } },
  });
}

async function handOver({ actor, contest, settings, submissionId, toId }) {
  const entry = await prisma.submission.findFirst({ where: { id: submissionId, contestId: contest.id } });
  if (!entry) throw new ReviewError('That entry no longer exists.');
  if (toId === actor.id || toId === entry.participantId) throw new ReviewError('Choose another reviewer.');
  if (!(await jurorsFor(contest.id, entry.wiki, settings)).includes(toId)) throw new ReviewError('This person is not on the reviewers for this wiki.');
  if (settings.reviewAssignment === 'assigned') {
    await prisma.reviewAssignment.deleteMany({ where: { contestId: contest.id, submissionId, jurorId: actor.id } });
    await prisma.reviewAssignment.upsert({ where: { submissionId_jurorId: { submissionId, jurorId: toId } }, update: {}, create: { contestId: contest.id, submissionId, jurorId: toId, assignedById: actor.id } });
  }
  await notifications.notify(toId, {
    kind: 'review.handover',
    message: settings.reviewAssignment === 'assigned' ? '{who} handed you “{title}” to review in {event}.' : '{who} asks you to review “{title}” in {event}.',
    params: { who: actor.username, title: entry.title, event: contest.title },
    link: `${pathOf(contest)}/review?entry=${submissionId}`,
    contestId: contest.id,
  });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'review.handover', entityType: 'Submission', entityId: submissionId, details: { title: entry.title, to: toId } });
}

// Reviewers who could take this entry (for the hand-over list).
async function handOverChoices({ contest, settings, entry, me }) {
  const ids = (await jurorsFor(contest.id, entry.wiki, settings)).filter((id) => id !== me && id !== entry.participantId);
  if (!ids.length) return [];
  return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true }, orderBy: { username: 'asc' } });
}

module.exports = {
  handOver, handOverChoices,
  reassignInactive,
  autoAssign,
  verdict, decide, DECISION_RULES, juryActivity, queuePage, QUEUE_SORTS,
  REVIEWABLE,
  assignedMode,
  jurorsFor,
  distribute,
  assign,
  unassign,
  releaseJuror,
  assignmentOverview,
  ReviewError,
  markScheme,
  scoreMarks,
  queue,
  entryForReview,
  saveReview,
  progress,
  leaderboard,
  setResultsPublished,
  canAppeal,
  createAppeal,
  resolveAppeal,
  appeals,
};
