const prisma = require('../config/prisma');

const DAY_MS = 24 * 60 * 60 * 1000;
const DECIDED = ['approved', 'rejected', 'disqualified'];
const INACTIVE = ['withdrawn'];

const dayKey = (d, timeZone = 'UTC') => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Counts per calendar day (in timeZone) between from and to, including empty days.
function dailySeries(dates, from, to, timeZone = 'UTC') {
  const counts = new Map();
  for (const d of dates) counts.set(dayKey(d, timeZone), (counts.get(dayKey(d, timeZone)) || 0) + 1);
  const labels = [];
  const values = [];
  const days = Math.min(400, Math.max(1, Math.ceil((to - from) / DAY_MS) + 1));
  for (let i = 0; i < days; i++) {
    const key = dayKey(new Date(from.getTime() + i * DAY_MS), timeZone);
    if (labels[labels.length - 1] === key) continue;
    labels.push(key);
    values.push(counts.get(key) || 0);
  }
  return { labels, values };
}

const toMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r._count._all]));

// wiki: limit submission numbers to one wiki of a multi-wiki event (people stay event-wide).
async function eventStats(contest, { wiki, now = new Date() } = {}) {
  const where = { contestId: contest.id, ...(wiki && { wiki }) };
  const [byStatus, byType, byWiki, top, memberships, dates] = await Promise.all([
    prisma.submission.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.submission.groupBy({ by: ['entryType'], where: { ...where, status: { notIn: INACTIVE } }, _count: { _all: true } }),
    prisma.submission.groupBy({ by: ['wiki'], where: { ...where, status: { notIn: INACTIVE } }, _count: { _all: true } }),
    prisma.submission.groupBy({
      by: ['participantId'],
      where: { ...where, status: { notIn: INACTIVE } },
      _count: { _all: true },
      orderBy: { _count: { participantId: 'desc' } },
      take: 10,
    }),
    prisma.contestMembership.groupBy({ by: ['role'], where: { contestId: contest.id, status: 'active' }, _count: { _all: true } }),
    prisma.submission.findMany({ where, select: { submittedAt: true }, orderBy: { submittedAt: 'asc' } }),
  ]);

  const status = toMap(byStatus, 'status');
  const total = Object.values(status).reduce((a, b) => a + b, 0);
  const active = total - (status.withdrawn || 0);
  const decided = DECIDED.reduce((n, s) => n + (status[s] || 0), 0);

  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.participantId) } }, select: { id: true, username: true } });
  const name = Object.fromEntries(users.map((u) => [u.id, u.username]));
  const approvedBy = await prisma.submission.groupBy({
    by: ['participantId'],
    where: { ...where, status: 'approved', participantId: { in: top.map((t) => t.participantId) } },
    _count: { _all: true },
  });
  const approvedMap = toMap(approvedBy, 'participantId');

  const from = contest.startDate && contest.startDate < now ? contest.startDate : dates[0]?.submittedAt || new Date(now - 13 * DAY_MS);
  const until = contest.endDate && contest.endDate < now ? contest.endDate : now;
  const series = dailySeries(dates.map((d) => d.submittedAt), from, until > from ? until : now, contest.timezone);

  return {
    total,
    active,
    status,
    decided,
    reviewProgress: active ? Math.round((decided / active) * 100) : 0,
    validRate: active ? Math.round(((active - (status.invalid || 0)) / active) * 100) : 0,
    byType: toMap(byType, 'entryType'),
    byWiki: toMap(byWiki, 'wiki'),
    roles: toMap(memberships, 'role'),
    topParticipants: top.map((t) => ({ username: name[t.participantId], count: t._count._all, approved: approvedMap[t.participantId] || 0 })),
    series,
    last7: series.values.slice(-7),
  };
}

async function userStats(userId, now = new Date(), days = 30) {
  const from = new Date(now - (days - 1) * DAY_MS);
  const [rows, byStatus] = await Promise.all([
    prisma.submission.findMany({ where: { participantId: userId, submittedAt: { gte: from }, contest: { deletedAt: null } }, select: { submittedAt: true } }),
    prisma.submission.groupBy({ by: ['status'], where: { participantId: userId, contest: { deletedAt: null } }, _count: { _all: true } }),
  ]);
  return { series: dailySeries(rows.map((r) => r.submittedAt), from, now), status: toMap(byStatus, 'status') };
}

async function platformStats(now = new Date(), days = 30) {
  const from = new Date(now - (days - 1) * DAY_MS);
  const [subs, signups, byType, byStatus, byWiki] = await Promise.all([
    prisma.submission.findMany({ where: { submittedAt: { gte: from } }, select: { submittedAt: true } }),
    prisma.user.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
    prisma.contest.groupBy({ by: ['type'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.contest.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.submission.groupBy({ by: ['wiki'], _count: { _all: true }, orderBy: { _count: { wiki: 'desc' } }, take: 6 }),
  ]);
  return {
    submissions: dailySeries(subs.map((s) => s.submittedAt), from, now),
    signups: dailySeries(signups.map((s) => s.createdAt), from, now),
    eventsByType: toMap(byType, 'type'),
    eventsByStatus: toMap(byStatus, 'status'),
    submissionsByWiki: toMap(byWiki, 'wiki'),
  };
}

module.exports = { eventStats, userStats, platformStats, dailySeries };
