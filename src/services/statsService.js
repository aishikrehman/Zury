const prisma = require('../config/prisma');

const DAY_MS = 24 * 60 * 60 * 1000;
const DECIDED = ['approved', 'rejected', 'disqualified'];
const INACTIVE = ['withdrawn'];

// One formatter per time zone; formatting is the slow part with 100,000+ entries.
const formatters = new Map();
const dayKey = (d, timeZone = 'UTC') => {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return formatters.get(timeZone).format(d);
};
// Every zone's offset is a multiple of 15 minutes, so entries in the same quarter hour share a day.
const QUARTER = 15 * 60 * 1000;

// Counts per calendar day (in timeZone) between from and to, including empty days.
function dailySeries(dates, from, to, timeZone = 'UTC') {
  const counts = new Map();
  const keyOf = new Map();
  for (const d of dates) {
    const q = Math.floor(new Date(d).getTime() / QUARTER);
    let key = keyOf.get(q);
    if (!key) keyOf.set(q, (key = dayKey(new Date(q * QUARTER), timeZone)));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
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
  const [byStatus, byType, byWiki, top, memberships, dates, words, approvedWords] = await Promise.all([
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
    prisma.submission.findMany({ where, select: { submittedAt: true, wordCount: true, status: true }, orderBy: { submittedAt: 'asc' } }),
    prisma.submission.aggregate({ where: { ...where, status: { notIn: INACTIVE } }, _sum: { wordCount: true } }),
    prisma.submission.aggregate({ where: { ...where, status: 'approved' }, _sum: { wordCount: true } }),
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
  // Words of the day's entries (not withdrawn), and of those accepted so far.
  const wordsOn = new Map();
  const acceptedOn = new Map();
  for (const d of dates) {
    if (INACTIVE.includes(d.status) || !d.wordCount) continue;
    const key = dayKey(new Date(d.submittedAt), contest.timezone);
    wordsOn.set(key, (wordsOn.get(key) || 0) + d.wordCount);
    if (d.status === 'approved') acceptedOn.set(key, (acceptedOn.get(key) || 0) + d.wordCount);
  }
  const wordSeries = { labels: series.labels, values: series.labels.map((l) => wordsOn.get(l) || 0), accepted: series.labels.map((l) => acceptedOn.get(l) || 0) };

  // Word statistics (when results count words): words by status, per participant, per article.
  let wordStats = null;
  const rankRow = await prisma.contestSettings.findUnique({ where: { contestId: contest.id }, select: { rankBy: true } });
  if (rankRow && ['words', 'both'].includes(rankRow.rankBy)) {
    const [byStatusW, byPerson, biggest] = await Promise.all([
      prisma.submission.groupBy({ by: ['status'], where: { ...where, status: { notIn: INACTIVE } }, _sum: { wordCount: true }, _count: { _all: true } }),
      prisma.submission.groupBy({ by: ['participantId'], where: { ...where, status: { notIn: INACTIVE } }, _sum: { wordCount: true }, _count: { _all: true }, orderBy: { _sum: { wordCount: 'desc' } }, take: 10 }),
      prisma.submission.findMany({ where: { ...where, status: { notIn: INACTIVE }, wordCount: { gt: 0 } }, select: { id: true, title: true, wordCount: true, status: true, participant: { select: { username: true } } }, orderBy: { wordCount: 'desc' }, take: 10 }),
    ]);
    const ws = Object.fromEntries(byStatusW.map((r) => [r.status, { words: r._sum.wordCount || 0, count: r._count._all }]));
    const pick = (keys) => keys.reduce((a, k) => ({ words: a.words + (ws[k]?.words || 0), count: a.count + (ws[k]?.count || 0) }), { words: 0, count: 0 });
    const accepted = pick(['approved']);
    const rejected = pick(['rejected', 'disqualified', 'invalid']);
    const pending = pick(['pending', 'validated', 'under_review', 'needs_review']);
    const all = pick(Object.keys(ws));
    const people = await prisma.user.findMany({ where: { id: { in: byPerson.map((p) => p.participantId) } }, select: { id: true, username: true } });
    const pn = Object.fromEntries(people.map((u) => [u.id, u.username]));
    const acc = await prisma.submission.groupBy({ by: ['participantId'], where: { ...where, status: 'approved', participantId: { in: byPerson.map((p) => p.participantId) } }, _sum: { wordCount: true } });
    const accMap = Object.fromEntries(acc.map((r) => [r.participantId, r._sum.wordCount || 0]));
    wordStats = {
      all, accepted, rejected, pending: { words: all.words - accepted.words - rejected.words, count: all.count - accepted.count - rejected.count },
      average: all.count ? Math.round(all.words / all.count) : 0,
      averageAccepted: accepted.count ? Math.round(accepted.words / accepted.count) : 0,
      people: byPerson.map((p) => ({ username: pn[p.participantId], words: p._sum.wordCount || 0, accepted: accMap[p.participantId] || 0, count: p._count._all })),
      biggest: biggest.map((b) => ({ id: b.id, title: b.title, words: b.wordCount, status: b.status, username: b.participant?.username })),
    };
  }

  return {
    wordStats,
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
    wordSeries,
    last7: series.values.slice(-7),
    words: words._sum.wordCount || 0,
    approvedWords: approvedWords._sum.wordCount || 0,
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

// Stage 6: totals for any set of events (an edition, a series), counted without doubles:
// - an entry is one page on one wiki (wiki + pageKey): the same article entered in two events
//   counts once; withdrawn entries don't count; it counts as approved if approved anywhere;
// - a person counts once however many events, editions or wikis they took part in
//   (registered participants and anyone who submitted);
// - words are those of the distinct approved entries.
const empty = () => ({ eventCount: 0, entries: 0, approved: 0, words: 0, approvedWords: 0, participants: 0, wikis: [] });

async function topPeople(contestIds, take = 25) {
  const ids = [...new Set(contestIds)].map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const { Prisma } = require('@prisma/client');
  const rows = await prisma.$queryRaw`
    SELECT s.participantId AS id, u.username AS username, COUNT(DISTINCT s.pageKey) AS entries,
           COUNT(DISTINCT CASE WHEN s.status = 'approved' THEN s.pageKey END) AS accepted,
           COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.wordCount ELSE 0 END), 0) AS words,
           COUNT(DISTINCT s.wiki) AS wikis
    FROM Submission s JOIN User u ON u.id = s.participantId
    WHERE s.contestId IN (${Prisma.join(ids)}) AND s.status <> 'withdrawn'
    GROUP BY s.participantId, u.username ORDER BY accepted DESC, entries DESC LIMIT ${take}`;
  return rows.map((r) => ({ username: r.username, entries: Number(r.entries), accepted: Number(r.accepted), words: Number(r.words), wikis: Number(r.wikis) }));
}

async function byWiki(contestIds) {
  const ids = [...new Set(contestIds)].map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const { Prisma } = require('@prisma/client');
  const rows = await prisma.$queryRaw`
    SELECT wiki, COUNT(DISTINCT pageKey) AS entries, COUNT(DISTINCT CASE WHEN status = 'approved' THEN pageKey END) AS approved,
           COUNT(DISTINCT participantId) AS participants
    FROM Submission WHERE contestId IN (${Prisma.join(ids)}) AND status <> 'withdrawn' GROUP BY wiki ORDER BY entries DESC`;
  return rows.map((r) => ({ wiki: r.wiki, entries: Number(r.entries), approved: Number(r.approved), participants: Number(r.participants) }));
}

async function rollup(contestIds) {
  const ids = [...new Set(contestIds)].map(Number).filter(Number.isInteger);
  if (!ids.length) return empty();
  const { Prisma } = require('@prisma/client');
  const inIds = Prisma.join(ids);
  // Counted by the database (a series can hold hundreds of thousands of entries): one row per
  // distinct page (pageKey, which names its wiki: bnwiki:123), approved if approved anywhere,
  // with its largest word count.
  const [[totals], [people], wikis] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS entries, COALESCE(SUM(w), 0) AS words, COALESCE(SUM(a), 0) AS approved, COALESCE(SUM(CASE WHEN a = 1 THEN w ELSE 0 END), 0) AS approvedWords
      FROM (SELECT MAX(COALESCE(wordCount, 0)) AS w, MAX(status = 'approved') AS a FROM Submission
            WHERE contestId IN (${inIds}) AND status <> 'withdrawn' GROUP BY pageKey) AS pages`,
    prisma.$queryRaw`
      SELECT COUNT(*) AS n FROM (
        SELECT participantId AS u FROM Submission WHERE contestId IN (${inIds}) AND status <> 'withdrawn'
        UNION SELECT userId FROM ContestMembership WHERE contestId IN (${inIds}) AND role = 'participant' AND status = 'active') AS people`,
    prisma.contestWiki.findMany({ where: { contestId: { in: ids }, status: { not: 'pending' } }, select: { wiki: true, code: true } }),
  ]);
  const num = (v) => Number(v || 0);
  return {
    eventCount: ids.length,
    entries: num(totals.entries),
    words: num(totals.words),
    approved: num(totals.approved),
    approvedWords: num(totals.approvedWords),
    participants: num(people.n),
    wikis: [...new Map(wikis.map((w) => [w.wiki, w])).values()],
  };
}

module.exports = {
  topPeople,
  byWiki, eventStats, userStats, platformStats, dailySeries, rollup };
