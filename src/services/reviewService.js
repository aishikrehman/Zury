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
async function queue({ contestId, settings, jurorId, wikis = null, after = 0 }) {
  const required = Math.max(1, settings.requiredReviews || 1);
  const where = {
    contestId,
    status: { in: REVIEWABLE },
    ...(wikis && { wiki: { in: wikis } }),
    reviews: { none: { jurorId } },
  };
  const candidates = await prisma.submission.findMany({
    where,
    orderBy: { id: 'asc' },
    select: { id: true, _count: { select: { reviews: true } } },
  });
  // Entries that already have all their reviews are waiting to be decided, not for this person.
  const open = candidates.filter((c) => c._count.reviews < required);
  const next = open.find((c) => c.id > after) || open[0] || null;
  const reviewedByMe = await prisma.review.count({ where: { contestId, jurorId } });
  return { nextId: next ? next.id : null, remaining: open.length, reviewedByMe };
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
    await audit.record(
      { actorId: actor.id, contestId: contest.id, action: 'submission.reviewed', entityType: 'Submission', entityId: submission.id, details: { title: submission.title, decision, points: scored.points } },
      tx,
    );
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
  let entries;
  let pointsOf;
  if (contest.type === 'proofread') {
    entries = await prisma.submission.findMany({ where: { ...where, status: { in: ['validated', 'approved'] } }, select: { participantId: true, metadata: true } });
    pointsOf = (e) => {
      const level = JSON.parse(e.metadata || '{}').proofread?.level;
      return level >= 4 ? typeConfig.pointsValidated : level === 3 ? typeConfig.pointsProofread : 0;
    };
  } else if (settings.juryReviewEnabled) {
    entries = await prisma.submission.findMany({ where: { ...where, status: 'approved' }, select: { participantId: true, score: true } });
    const hasMarks = markScheme(settings).length > 0;
    pointsOf = (e) => (hasMarks ? e.score || 0 : 1);
  } else {
    entries = await prisma.submission.findMany({ where: { ...where, status: { in: ['validated', 'approved'] } }, select: { participantId: true } });
    pointsOf = () => 1;
  }
  const rows = new Map();
  for (const e of entries) {
    const row = rows.get(e.participantId) || { participantId: e.participantId, entries: 0, points: 0 };
    row.entries += 1;
    row.points += pointsOf(e);
    rows.set(e.participantId, row);
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, points: Math.round(r.points * 100) / 100, username: name[r.participantId] }))
    .sort((a, b) => b.points - a.points || b.entries - a.entries || a.username.localeCompare(b.username));
  // Equal points share a rank.
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.points !== sorted[i - 1].points) rank = i + 1;
    return { ...r, rank };
  });
}

async function setResultsPublished({ actor, contest, published }) {
  await prisma.contest.update({ where: { id: contest.id }, data: { resultsPublishedAt: published ? new Date() : null } });
  await audit.record({ actorId: actor.id, contestId: contest.id, action: published ? 'results.published' : 'results.unpublished', entityType: 'Contest', entityId: contest.id, details: { title: contest.title } });
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

module.exports = {
  REVIEWABLE,
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
