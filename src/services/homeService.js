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
  const [[tot], [month], wikis, recent, finished, series] = await Promise.all([
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
    prisma.submission.findMany({
      where: { status: 'approved', contest: { ...PUBLIC, settings: { anonymousParticipants: false } } },
      orderBy: { updatedAt: 'desc' }, take: 8,
      select: { id: true, title: true, url: true, wiki: true, wordCount: true, entryType: true, participant: { select: { username: true } }, contest: { select: { title: true, path: true, slug: true } } },
    }),
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
  const reviewService = require('./reviewService');
  const winners = [];
  for (const { settings, ...c } of finished) {
    const board = await reviewService.leaderboard({ contest: c, settings, wiki: null }).catch(() => []);
    if (board.length) winners.push({ title: c.title, path: c.path, top: board.slice(0, 3).map((r) => ({ username: r.username, words: r.words, entries: r.entries })) });
  }
  const n = (v) => Number(v || 0);
  const data = {
    totals: { articles: n(tot.articles), words: n(tot.words), people: n(tot.people), wikis: n(tot.wikis), entries: n(tot.entries) },
    month: { entries: n(month.entries), words: n(month.words), people: n(month.people) },
    wikis: wikis.map((w) => ({ wiki: w.wiki, entries: n(w.entries), people: n(w.people) })),
    recent,
    winners,
    series,
  };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { overview };
