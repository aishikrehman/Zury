// The public, read-only API: what anyone can already see on Zury's pages, as JSON.
// Private and draft events never appear; unlisted ones only by their own address.
// Participant names follow the event's "anonymous participants" setting; results appear
// only once they are open to everyone under the event's results rule.
const prisma = require('../config/prisma');
const reviewService = require('./reviewService');
const { dbnameToHost } = require('../wiki/wikiUrls');

const SITE = (() => { try { return new URL(process.env.WIKIMEDIA_CALLBACK_URL).origin; } catch { return 'https://zury.toolforge.org'; } })();
const PUBLIC_STATUS = { approved: 'accepted', rejected: 'not_accepted', disqualified: 'not_accepted', withdrawn: 'withdrawn' };
const publicStatus = (s) => PUBLIC_STATUS[s] || 'pending';
const day = (d) => (d ? new Date(d).toISOString() : null);

// An event's totals: participants, entries, accepted, words accepted.
async function totals(contestIds, wiki = null) {
  const where = { contestId: { in: contestIds }, status: { not: 'withdrawn' }, ...(wiki && { wiki }) };
  const [byStatus, people, words] = await Promise.all([
    prisma.submission.groupBy({ by: ['contestId', 'status'], where, _count: { _all: true } }),
    prisma.submission.groupBy({ by: ['contestId', 'participantId'], where }),
    prisma.submission.groupBy({ by: ['contestId'], where: { ...where, status: 'approved' }, _sum: { wordCount: true } }),
  ]);
  const out = new Map(contestIds.map((id) => [id, { participants: 0, entries: 0, accepted: 0, notAccepted: 0, pending: 0, wordsAccepted: 0 }]));
  for (const r of byStatus) {
    const t = out.get(r.contestId); const n = r._count._all; const st = publicStatus(r.status);
    t.entries += n;
    if (st === 'accepted') t.accepted += n; else if (st === 'not_accepted') t.notAccepted += n; else t.pending += n;
  }
  for (const r of people) out.get(r.contestId).participants += 1;
  for (const r of words) out.get(r.contestId).wordsAccepted = r._sum.wordCount || 0;
  return out;
}

function eventSummary(c, t) {
  return {
    id: c.id,
    title: c.title,
    url: SITE + (c.path || `/contest/${c.id}`),
    path: c.path || `/contest/${c.id}`,
    type: c.type,
    status: c.status,
    start: day(c.startDate),
    end: day(c.endDate),
    wiki: c.primaryWiki,
    wikis: (c.wikis || []).filter((w) => w.status !== 'pending').map((w) => w.wiki),
    ...(t && { totals: t }),
  };
}

// One event (or one wiki of it), from the request the event pages already set up.
async function event(req) {
  const c = req.contest; const wiki = req.wikiScope ? req.wikiScope.wiki : null;
  const t = (await totals([c.id], wiki)).get(c.id);
  return {
    ...eventSummary({ ...c, wikis: req.allWikis }, t),
    ...(wiki && { scope: wiki }),
    series: req.series ? { slug: req.series.slug, title: req.series.title, url: `${SITE}/${req.series.slug}` } : null,
    edition: req.edition ? { slug: req.edition.slug, title: req.edition.title, url: `${SITE}/${req.series.slug}/${req.edition.slug}` } : null,
    resultsOpen: reviewService.resultsOpen(c, req.settings),
    links: {
      entries: `${SITE}${req.base}/entries.json`,
      results: `${SITE}${req.base}/results.json`,
    },
  };
}

// The entries: article, wiki, participant (unless anonymous), status, words, when.
async function entries(req, { page = 1, perPage = 500 } = {}) {
  const c = req.contest; const wiki = req.wikiScope ? req.wikiScope.wiki : null;
  const anonymous = !!req.settings.anonymousParticipants;
  const where = { contestId: c.id, status: { not: 'withdrawn' }, ...(wiki && { wiki }) };
  const [count, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: { id: true, title: true, wiki: true, status: true, wordCount: true, submittedAt: true, participant: { select: { username: true } } },
    }),
  ]);
  return {
    event: { title: c.title, path: c.path, ...(wiki && { scope: wiki }) },
    total: count,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(count / perPage)),
    entries: rows.map((s) => ({
      id: s.id,
      title: s.title,
      wiki: s.wiki,
      url: `https://${dbnameToHost(s.wiki)}/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
      participant: anonymous ? null : s.participant.username,
      status: publicStatus(s.status),
      words: s.wordCount,
      submitted: day(s.submittedAt),
    })),
  };
}

// The ranking, only once results are open to everyone.
async function results(req) {
  const c = req.contest; const wiki = req.wikiScope ? req.wikiScope.wiki : null;
  if (!reviewService.resultsOpen(c, req.settings)) return { event: { title: c.title, path: c.path }, resultsOpen: false, results: [] };
  const rows = await reviewService.leaderboard({ contest: c, settings: req.eventSettings, wiki });
  const anonymous = !!req.settings.anonymousParticipants;
  return {
    event: { title: c.title, path: c.path, ...(wiki && { scope: wiki }) },
    resultsOpen: true,
    final: reviewService.resultsFinal(c, req.settings),
    results: rows.map((r, i) => ({
      rank: r.rank || i + 1,
      participant: anonymous ? null : r.username || (r.user && r.user.username) || null,
      submitted: r.submitted ?? null,
      accepted: r.entries ?? null,
      words: r.words ?? null,
      points: r.points ?? null,
    })),
  };
}

const LISTED = { deletedAt: null, visibility: 'public', status: { not: 'draft' } };
const EVENT_SELECT = { id: true, title: true, path: true, type: true, status: true, startDate: true, endDate: true, primaryWiki: true, wikis: { select: { wiki: true, status: true } } };

// A series, or one of its editions: its details, editions and events with their totals.
async function level(seriesSlug, editionSlug = null) {
  const series = await prisma.eventSeries.findUnique({ where: { slug: seriesSlug } });
  if (!series || series.visibility === 'private' || series.status === 'draft') return null;
  let edition = null;
  if (editionSlug) {
    edition = await prisma.edition.findUnique({ where: { seriesId_slug: { seriesId: series.id, slug: editionSlug } } });
    if (!edition || edition.visibility === 'private') return null;
  }
  const where = edition ? { ...LISTED, editionId: edition.id } : { ...LISTED, OR: [{ seriesId: series.id }, { editionOf: { seriesId: series.id } }] };
  const events = await prisma.contest.findMany({ where, select: { ...EVENT_SELECT, editionId: true }, orderBy: [{ startDate: 'desc' }, { title: 'asc' }] });
  const t = await totals(events.map((e) => e.id));
  const sum = (k) => events.reduce((n, e) => n + t.get(e.id)[k], 0);
  const editions = edition ? null : await prisma.edition.findMany({ where: { seriesId: series.id, visibility: { not: 'private' }, NOT: { slug: { startsWith: '~' } } }, select: { id: true, slug: true, title: true, status: true, startDate: true, endDate: true }, orderBy: [{ startDate: 'desc' }, { slug: 'desc' }] });
  return {
    series: { slug: series.slug, title: series.title, url: `${SITE}/${series.slug}`, description: series.shortDescription || '', logo: series.logoUrl || null },
    ...(edition && { edition: { slug: edition.slug, title: edition.title, status: edition.status, start: day(edition.startDate), end: day(edition.endDate), url: `${SITE}/${series.slug}/${edition.slug}`, logo: edition.logoUrl || null } }),
    totals: { events: events.length, entries: sum('entries'), accepted: sum('accepted'), wordsAccepted: sum('wordsAccepted') },
    ...(editions && { editions: editions.map((e) => ({ slug: e.slug, title: e.title, status: e.status, start: day(e.startDate), end: day(e.endDate), url: `${SITE}/${series.slug}/${e.slug}`, api: `${SITE}/api/v1/series/${series.slug}/${e.slug}` })) }),
    events: events.map((e) => ({ ...eventSummary(e, t.get(e.id)), api: `${SITE}${e.path}/api.json` })),
  };
}

// Listed events, newest first, filtered by status group, wiki or type.
async function events({ status, wiki, type, page = 1, perPage = 100 }) {
  const { STATUS_GROUPS } = require('../utils/contestLabels');
  const where = { ...LISTED, ...(STATUS_GROUPS[status] && { status: { in: STATUS_GROUPS[status] } }), ...(wiki && { wikis: { some: { wiki } } }), ...(type && { type }) };
  const [count, rows] = await Promise.all([
    prisma.contest.count({ where }),
    prisma.contest.findMany({ where, select: EVENT_SELECT, orderBy: [{ startDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * perPage, take: perPage }),
  ]);
  return { total: count, page, perPage, pages: Math.max(1, Math.ceil(count / perPage)), events: rows.map((e) => ({ ...eventSummary(e), api: `${SITE}${e.path}/api.json` })) };
}

module.exports = { event, entries, results, level, events };
