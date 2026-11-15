// The public home page's picture of everything: totals, this month, wikis, the latest accepted
// articles, recent winners and the series. Only public, non-draft events, and never names from
// events whose participants are anonymous. Kept for a few minutes (it is the same for everyone).
const prisma = require('../config/prisma');

const TTL = 5 * 60 * 1000;
let cache = null;

const PUBLIC = { deletedAt: null, visibility: 'public', status: { not: 'draft' } };

async function overview() {
  if (cache && cache.at > Date.now() - TTL) return cache.data;
  const { Prisma } = require('@prisma/client');
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [[tot], [month], wikis, finished, series] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT CASE WHEN s.status = 'approved' THEN s.pageKey END) AS articles,
             COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.wordCount ELSE 0 END), 0) AS words,
             COUNT(DISTINCT s.participantId) AS people, COUNT(DISTINCT s.wiki) AS wikis, COUNT(*) AS entries
      FROM Submission s JOIN Contest c ON c.id = s.contestId
      WHERE c.deletedAt IS NULL AND c.visibility = 'public' AND c.status <> 'draft' AND s.status <> 'withdrawn'`,
    prisma.$queryRaw`
      SELECT COUNT(*) AS entries, COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.wordCount ELSE 0 END), 0) AS words,
             COUNT(DISTINCT s.participantId) AS people
      FROM Submission s JOIN Contest c ON c.id = s.contestId
      WHERE c.deletedAt IS NULL AND c.visibility = 'public' AND c.status <> 'draft' AND s.status <> 'withdrawn' AND s.submittedAt >= ${monthStart}`,
    prisma.$queryRaw`
      SELECT s.wiki AS wiki, COUNT(*) AS entries, COUNT(DISTINCT s.participantId) AS people
      FROM Submission s JOIN Contest c ON c.id = s.contestId
      WHERE c.deletedAt IS NULL AND c.visibility = 'public' AND c.status <> 'draft' AND s.status <> 'withdrawn'
      GROUP BY s.wiki ORDER BY entries DESC LIMIT 12`,
    prisma.contest.findMany({
      where: { ...PUBLIC, resultsPublishedAt: { not: null }, settings: { anonymousParticipants: false } },
      orderBy: { resultsPublishedAt: 'desc' }, take: 3, include: { settings: true },
    }),
    prisma.eventSeries.findMany({
      where: { deletedAt: null, visibility: 'public', status: 'active' },
      orderBy: { updatedAt: 'desc' }, take: 6,
      select: { slug: true, title: true, shortDescription: true, logoUrl: true, _count: { select: { editionRecords: true } } },
    }).catch(() => []),
  ]);
  // Events by Wikimedia project (Wikipedia, Commons, Wikidata…): how many in all, how many running.
  const { eventProject } = require('../utils/projectStyle');
  const evs = await prisma.contest.findMany({ where: PUBLIC, select: { status: true, primaryWiki: true, wikis: { select: { wiki: true } } } });
  const projects = {};
  for (const c of evs) { const p = eventProject(c); const x = (projects[p.key] ||= { key: p.key, label: p.label, icon: p.icon, color: p.color, total: 0, running: 0 }); x.total += 1; if (c.status === 'active') x.running += 1; }
  const reviewService = require('./reviewService');
  const winners = [];
  for (const { settings, ...c } of finished) {
    const board = await reviewService.leaderboard({ contest: c, settings, wiki: null }).catch(() => []);
    if (board.length) winners.push({ title: c.title, path: c.path, top: board.slice(0, 3).map((r) => ({ username: r.username, words: r.words, entries: r.entries })) });
  }
  const n = (v) => Number(v || 0);
  const named = { ...PUBLIC, settings: { anonymousParticipants: false } };
  const soon = new Date(Date.now() + 7 * 86400000);
  const [ending, ticker, topRows, communityRows, photoRows] = await Promise.all([
    // Running events that end within a week.
    prisma.contest.findMany({ where: { ...PUBLIC, status: 'active', endDate: { gte: new Date(), lte: soon } }, orderBy: { endDate: 'asc' }, take: 6, select: { title: true, path: true, slug: true, endDate: true, primaryWiki: true, wikis: { select: { wiki: true } } } }),
    // The latest entries' titles, for the ticker (no names).
    prisma.submission.findMany({ where: { status: { not: 'withdrawn' }, contest: PUBLIC }, orderBy: { submittedAt: 'desc' }, take: 16, select: { title: true, url: true, wiki: true } }),
    // This month's top contributors (accepted words, then accepted entries), named events only.
    prisma.$queryRaw`
      SELECT u.username AS username, SUM(p.a) AS accepted, SUM(CASE WHEN p.a = 1 THEN p.w ELSE 0 END) AS words, COUNT(*) AS entries
      FROM (SELECT s.participantId AS uid, s.pageKey, MAX(s.status = 'approved') AS a, MAX(COALESCE(s.wordCount, 0)) AS w
            FROM Submission s JOIN Contest c ON c.id = s.contestId JOIN ContestSettings cs ON cs.contestId = c.id
            WHERE c.deletedAt IS NULL AND c.visibility = 'public' AND c.status <> 'draft' AND cs.anonymousParticipants = 0
              AND s.status <> 'withdrawn' AND s.submittedAt >= ${monthStart}
            GROUP BY s.participantId, s.pageKey) AS p JOIN User u ON u.id = p.uid
      GROUP BY u.username ORDER BY words DESC, accepted DESC, entries DESC LIMIT 3`,
    // The communities that organize public events.
    prisma.contest.groupBy({ by: ['organizingCommunity'], where: { ...PUBLIC, organizingCommunity: { not: '' } }, _count: { _all: true }, orderBy: { _count: { organizingCommunity: 'desc' } }, take: 16 }),
    // A recent picture from each running photo event, for its card.
    prisma.submission.findMany({ where: { entryType: 'file', status: { notIn: ['withdrawn', 'rejected', 'disqualified'] }, contest: { ...PUBLIC, status: 'active' } }, orderBy: { submittedAt: 'desc' }, take: 60, select: { contestId: true, metadata: true } }),
  ]);
  const photos = {};
  for (const r of photoRows) {
    if (photos[r.contestId]) continue;
    try { const m = JSON.parse(r.metadata || '{}'); if (m.file && m.file.thumbUrl) photos[r.contestId] = m.file.thumbUrl; } catch { /* skip */ }
  }
  const data = {
    ending: ending.map((c) => ({ ...c, days: Math.max(0, Math.ceil((new Date(c.endDate) - Date.now()) / 86400000)) })),
    ticker,
    top: topRows.map((r) => ({ username: r.username, accepted: n(r.accepted), words: n(r.words), entries: n(r.entries) })),
    communities: communityRows.map((r) => ({ name: r.organizingCommunity, events: r._count._all })),
    photos,
    totals: { articles: n(tot.articles), words: n(tot.words), people: n(tot.people), wikis: n(tot.wikis), entries: n(tot.entries) },
    month: { entries: n(month.entries), words: n(month.words), people: n(month.people) },
    wikis: wikis.map((w) => ({ wiki: w.wiki, entries: n(w.entries), people: n(w.people), place: require('../utils/wikiPlaces').placeOf(w.wiki) })),
    winners,
    series,
    projects: Object.values(projects).sort((a, b) => b.total - a.total),
  };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { overview };
