// Jury review: each jury member gives an entry a decision (accept or reject)
// and the event's marks. Once an entry has the reviews it needs, the majority
// decides, and its score is the average of the points. Also results and appeals.
const prisma = require('../config/prisma');
const audit = require('./auditService');
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

/**
 * The next entry for a jury member. wikis: the wikis they may judge (null = all).
 * after: skip entries up to this id (the "skip" button).
 */
const assignedMode = (settings) => settings.reviewAssignment === 'assigned';

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
    NOT: { participantId: jurorId },
  };
  const order = QUEUE_SORTS[filters.sort] || QUEUE_SORTS.oldest;
  const candidates = await prisma.submission.findMany({
    where,
    orderBy: [...order, { id: 'asc' }],
    select: { id: true, _count: { select: { reviews: true } } },
  });
  // Entries that already have all their reviews are waiting to be decided, not for this person.
  const list = mode === 'waiting' ? candidates.filter((c) => c._count.reviews < required) : candidates;
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

// The strip of entries at the top of the review page: the current one and those around it.
async function queueStrip({ ids, currentId, jurorId, size = 14 }) {
  const at = Math.max(0, ids.indexOf(currentId));
  const start = Math.max(0, Math.min(at - 2, ids.length - size));
  const window = ids.slice(start, start + size);
  if (currentId && !window.includes(currentId)) window.unshift(currentId);
  const rows = await prisma.submission.findMany({
    where: { id: { in: window } },
    select: { id: true, title: true, wordCount: true, status: true, participant: { select: { username: true } }, reviews: { where: { jurorId }, select: { decision: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { items: window.map((id) => byId.get(id)).filter(Boolean), position: ids.indexOf(currentId) + 1, total: ids.length };
}

// Each jury member's work: reviews, accepted and rejected, and when they last reviewed.
async function juryActivity(contestId, { wiki } = {}) {
  const where = { contestId, ...(wiki && { submission: { wiki } }) };
  const [byDecision, last] = await Promise.all([
    prisma.review.groupBy({ by: ['jurorId', 'decision'], where, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['jurorId'], where, _max: { updatedAt: true } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: last.map((r) => r.jurorId) } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const rows = last.map((r) => {
    const of = (d) => byDecision.find((x) => x.jurorId === r.jurorId && x.decision === d)?._count._all || 0;
    return { id: r.jurorId, username: name[r.jurorId], accepted: of('accept'), rejected: of('reject'), reviews: of('accept') + of('reject'), lastAt: r._max.updatedAt };
  });
  const most = Math.max(1, ...rows.map((r) => r.reviews));
  return rows.sort((x, y) => y.reviews - x.reviews).map((r) => ({ ...r, share: Math.round((r.reviews / most) * 100) }));
}

async function entryForReview(contestId, submissionId) {
  return prisma.submission.findFirst({
    where: { id: submissionId, contestId },
    include: {
      participant: { select: { id: true, username: true } },
      reviews: { include: { juror: { select: { username: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
}

/**
 * Saves (or updates) one jury member's review, then decides the entry once it
 * has enough reviews. Returns { status, decided }.
 */
async function saveReview({ actor, contest, settings, submission, decision, marks, comment }) {
  if (!DECISIONS.includes(decision)) throw new ReviewError('Choose accept or reject.');
  if (!REVIEWABLE.includes(submission.status) && !submission.reviews.some((r) => r.jurorId === actor.id)) {
    throw new ReviewError('This entry has already been decided.');
  }
  if (submission.participantId === actor.id) throw new ReviewError("You can't review your own entry.", 403);
  if (assignedMode(settings) && !submission.reviews.some((r) => r.jurorId === actor.id)) {
    const assigned = await prisma.reviewAssignment.count({ where: { submissionId: submission.id, jurorId: actor.id } });
    if (!assigned) throw new ReviewError('This entry is not assigned to you.', 403);
  }
  const scored = scoreMarks(markScheme(settings), marks);
  const required = Math.max(1, settings.requiredReviews || 1);

  return prisma.$transaction(async (tx) => {
    const data = { decision, marks: JSON.stringify(scored.marks), points: scored.points, comment: String(comment || '').trim().slice(0, 2000) };
    await tx.review.upsert({
      where: { submissionId_jurorId: { submissionId: submission.id, jurorId: actor.id } },
      update: data,
      create: { ...data, contestId: contest.id, submissionId: submission.id, jurorId: actor.id },
    });
    const reviews = await tx.review.findMany({ where: { submissionId: submission.id } });
    let status = 'under_review';
    let score = null;
    if (reviews.length >= required) {
      const accepts = reviews.filter((r) => r.decision === 'accept').length;
      status = accepts * 2 > reviews.length ? 'approved' : 'rejected';
      score = Math.round((reviews.reduce((n, r) => n + r.points, 0) / reviews.length) * 100) / 100;
    }
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
  const byWords = !!settings.wordCountEnabled;
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
    const jury = settings.juryReviewEnabled;
    const hasMarks = jury && markScheme(settings).length > 0;
    const grouped = await prisma.submission.groupBy({
      by: ['participantId'],
      where: { ...where, status: jury ? 'approved' : { in: ['validated', 'approved'] } },
      _count: { _all: true },
      _sum: { score: true, wordCount: true },
    });
    for (const g of grouped) {
      rows.set(g.participantId, { participantId: g.participantId, entries: g._count._all, points: hasMarks ? g._sum.score || 0 : g._count._all, words: g._sum.wordCount || 0 });
    }
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, points: Math.round(r.points * 100) / 100, username: name[r.participantId] }))
    .sort((a, b) => (byWords ? b.words - a.words : 0) || b.points - a.points || b.entries - a.entries || a.username.localeCompare(b.username));
  // Equal scores share a rank.
  const key = (r) => (byWords ? r.words : r.points);
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || key(r) !== key(sorted[i - 1])) rank = i + 1;
    return { ...r, rank };
  });
}

async function setResultsPublished({ actor, contest, published }) {
  await prisma.contest.update({ where: { id: contest.id }, data: { resultsPublishedAt: published ? new Date() : null } });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: published ? 'results.published' : 'results.unpublished', entityType: 'Contest', entityId: contest.id, details: { title: contest.title } });
}

// ── Assignments ────────────────────────────────────────────────────────────

// Jury members who may review entries from this wiki: event-wide jury and that wiki's jury.
async function jurorsFor(contestId, wiki) {
  const rows = await prisma.contestMembership.findMany({
    where: {
      contestId,
      role: 'jury',
      status: 'active',
      wiki: { in: ['', wiki] },
      user: { eventBlocks: { none: { contestId, liftedAt: null } } },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Gives every entry still waiting for the jury as many jury members as it
 * needs reviews, picking the least busy each time and never the entry's own
 * author. Existing assignments are kept. Returns { created, unfilled }.
 */
async function distribute({ actor, contest, settings, wiki }) {
  const required = Math.max(1, settings.requiredReviews || 1);
  const entries = await prisma.submission.findMany({
    where: { contestId: contest.id, status: { in: REVIEWABLE }, ...(wiki && { wiki }) },
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
    if (!jurorCache.has(e.wiki)) jurorCache.set(e.wiki, await jurorsFor(contest.id, e.wiki));
    const taken = new Set([...e.assignments.map((a) => a.jurorId), ...e.reviews.map((r) => r.jurorId)]);
    let missing = required - taken.size;
    const pool = jurorCache.get(e.wiki).filter((id) => id !== e.participantId && !taken.has(id));
    while (missing > 0 && pool.length) {
      pool.sort((a, b) => (loads.get(a) || 0) - (loads.get(b) || 0) || a - b);
      const jurorId = pool.shift();
      data.push({ contestId: contest.id, submissionId: e.id, jurorId, assignedById: actor.id });
      loads.set(jurorId, (loads.get(jurorId) || 0) + 1);
      missing -= 1;
    }
    if (missing > 0) unfilled += 1;
  }
  if (data.length) await prisma.reviewAssignment.createMany({ data });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: 'assignments.distributed', entityType: 'Contest', entityId: contest.id, details: { created: data.length, unfilled, wiki: wiki || undefined } });
  return { created: data.length, unfilled };
}

async function assign({ actor, contest, submissionId, jurorId }) {
  const entry = await prisma.submission.findFirst({ where: { id: submissionId, contestId: contest.id } });
  if (!entry) throw new ReviewError('That entry no longer exists.');
  if (entry.participantId === jurorId) throw new ReviewError("Jury members can't review their own entries.");
  if (!(await jurorsFor(contest.id, entry.wiki)).includes(jurorId)) throw new ReviewError('This person is not on the jury for this wiki.');
  await prisma.reviewAssignment.upsert({
    where: { submissionId_jurorId: { submissionId, jurorId } },
    update: {},
    create: { contestId: contest.id, submissionId, jurorId, assignedById: actor.id },
  });
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
  const jury = await prisma.contestMembership.findMany({
    where: { contestId, role: 'jury', status: 'active', ...(wiki && { wiki: { in: ['', wiki] } }) },
    include: { user: { select: { id: true, username: true } } },
  });
  const jurors = new Map();
  for (const m of jury) {
    const j = jurors.get(m.userId) || { id: m.userId, username: m.user.username, wikis: [], assigned: 0, reviewed: 0 };
    j.wikis.push(m.wiki);
    jurors.set(m.userId, j);
  }
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
  const unassigned = entries.filter((e) => e.assignments.length < required).length;
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
  return !contest.appealDeadline || now <= contest.appealDeadline;
}

async function createAppeal({ user, contest, settings, submission, reason }) {
  if (!canAppeal({ submission, contest, settings, user })) throw new ReviewError('This entry cannot be appealed.');
  reason = String(reason || '').trim();
  if (reason.length < 10 || reason.length > 2000) throw new ReviewError('Explain the appeal in 10 to 2000 characters.');
  return prisma.$transaction(async (tx) => {
    const appeal = await tx.appeal.create({ data: { contestId: contest.id, submissionId: submission.id, userId: user.id, reason } });
    await tx.submission.update({
      where: { id: submission.id },
      data: { status: 'appealed', history: { create: { actorId: user.id, action: 'appealed', previousValue: submission.status, newValue: 'appealed', note: reason.slice(0, 500) } } },
    });
    await audit.record({ actorId: user.id, contestId: contest.id, action: 'appeal.created', entityType: 'Submission', entityId: submission.id, details: { title: submission.title } }, tx);
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
    await audit.record({ actorId: actor.id, contestId: contest.id, action: `appeal.${upheld ? 'upheld' : 'dismissed'}`, entityType: 'Submission', entityId: appeal.submissionId, details: { title: appeal.submission.title } }, tx);
  });
}

function appeals(contestId) {
  return prisma.appeal.findMany({
    where: { contestId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { submission: { select: { id: true, title: true, url: true, wiki: true } }, user: { select: { username: true } }, resolvedBy: { select: { username: true } } },
  });
}

module.exports = { juryActivity, queueStrip, queuePage, QUEUE_SORTS,
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
