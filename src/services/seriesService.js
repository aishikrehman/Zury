// Event series (/wam): its editions (each holding zero or more events) and events directly
// under it, a summary across the years, and the next edition made from the latest one.
const prisma = require('../config/prisma');
const audit = require('./auditService');

class SeriesError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function create({ actorId, slug, title, description = '' }) {
  slug = String(slug || '').trim().toLowerCase();
  title = String(title || '').trim();
  if (!title) throw new SeriesError('Give the series a name.', 'title');
  if (!SLUG.test(slug) || slug.length > 40) throw new SeriesError('Use lowercase letters, numbers and single hyphens (max 40).', 'slug');
  const { RESERVED } = require('../middleware/permissions');
  if (RESERVED.has(slug)) throw new SeriesError('That address is reserved.', 'slug');
  if ((await prisma.eventSeries.findUnique({ where: { slug } })) || (await prisma.contest.findFirst({ where: { path: `/${slug}` }, select: { id: true } }))) {
    throw new SeriesError(`/${slug} is already taken.`, 'slug');
  }
  const series = await prisma.eventSeries.create({ data: { slug, title, description: String(description).trim().slice(0, 2000), createdById: actorId || null } });
  // Whoever makes the series runs it (this level only).
  if (actorId) await prisma.scopeRole.create({ data: { userId: actorId, role: 'organizer', seriesId: series.id, assignedById: actorId } });
  await audit.record({ actorId, action: 'series.created', entityType: 'EventSeries', entityId: series.id, details: { slug, title } });
  return series;
}

// Editions of a series, newest first, each with its events' totals: entries, accepted,
// people (each counted once per edition) and wikis, without doubles. drafts: also editions and events not
// yet published, for those who run the series.
async function summary(seriesId, { drafts = false } = {}) {
  const shown = drafts ? {} : { status: { not: 'draft' }, visibility: 'public' };
  const editions = await prisma.edition.findMany({
    where: { seriesId, deletedAt: null, ...(drafts ? {} : { visibility: 'public' }) },
    // The organizers' order when they set one; else the newest first.
    orderBy: [{ sortOrder: 'asc' }, { year: 'desc' }, { slug: 'desc' }],
    select: {
      id: true, slug: true, title: true, status: true, startDate: true, endDate: true, identifier: true, cycleType: true, year: true, featured: true, visibility: true, sortOrder: true,
      events: { where: { deletedAt: null, ...shown }, select: { id: true, slug: true, title: true, status: true, path: true, wikis: { where: { status: { not: 'pending' } }, select: { code: true, wiki: true } } } },
    },
  });
  // Each edition's totals, counted without doubles (statsService).
  const { rollup } = require('./statsService');
  // An edition with its one event shows that event's status (an archived edition stays archived).
  const statusOf = (e) => (e.status !== 'archived' && e.events.length === 1 ? e.events[0].status : e.status);
  // Visitors don't see editions still in draft (by the status shown).
  const listed = editions.filter((e) => drafts || statusOf(e) !== 'draft');
  return Promise.all(listed.map(async (e) => ({ ...e, status: statusOf(e), edition: e.slug, ...(await rollup(e.events.map((ev) => ev.id))) })));
}

// The next edition: a year after the latest, with a copy of each of its events (settings,
// wikis, organizers and jury, dates a year later) as drafts. An empty latest edition gives
// an empty next one.
async function nextEdition({ actorId, series }) {
  const latest = await prisma.edition.findFirst({
    where: { seriesId: series.id, deletedAt: null },
    orderBy: [{ year: 'desc' }, { slug: 'desc' }],
  });
  if (!latest) throw new SeriesError('This series has no edition to start from.');
  const year = Number.parseInt(latest.slug, 10);
  if (!Number.isFinite(year)) throw new SeriesError(`The latest edition (${latest.slug}) isn't a year; create the next one by hand.`);
  const slug = String(year + 1);
  if (await prisma.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: series.id, slug } } })) throw new SeriesError(`/${series.slug}/${slug} already exists.`);

  // A copy of the latest edition, a year later: its events (as drafts), people and settings.
  return require('./structureService').copyEdition({ actorId, edition: latest, slug, title: latest.title.replace(String(year), slug), years: 1 });
}

// An empty edition (events are added to it afterwards).
async function createEdition({ actorId, series, slug, title = '', startDate = null, endDate = null }) {
  const editionService = require('./editionService');
  slug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(slug)) throw new SeriesError('Give the edition a short name, such as 2026.', 'edition');
  if (['new-edition', 'detach', 'order', 'deleted', 'settings', 'people', 'fountain'].includes(slug)) throw new SeriesError('That address is reserved.', 'edition');
  if (await prisma.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: series.id, slug } } })) throw new SeriesError(`/${series.slug}/${slug} already exists.`, 'edition');
  if (startDate && endDate && endDate < startDate) throw new SeriesError('The end date must be after the start date.', 'endDate');
  const edition = await editionService.findOrCreate(series.id, slug, { title: String(title || '').trim() || `${series.title} ${slug}`, startDate, endDate });
  await prisma.edition.update({ where: { id: edition.id }, data: { identifier: edition.identifier || slug, createdById: actorId || null } });
  if (actorId) await prisma.scopeRole.create({ data: { userId: actorId, role: 'organizer', editionId: edition.id, assignedById: actorId } });
  await audit.record({ actorId, action: 'edition.created', entityType: 'Edition', entityId: edition.id, details: { series: series.slug, edition: slug } });
  return edition;
}

// Every series with its editions (newest first) and direct events, for the management page.
async function listAll() {
  const series = await prisma.eventSeries.findMany({
    where: { deletedAt: null },
    orderBy: { title: 'asc' },
    include: {
      editionRecords: { where: { deletedAt: null }, orderBy: [{ year: 'desc' }, { slug: 'desc' }], select: { id: true, slug: true, title: true, status: true, startDate: true, _count: { select: { events: { where: { deletedAt: null } } } } } },
      editions: { where: { deletedAt: null }, select: { id: true, slug: true, title: true, status: true, path: true } },
    },
  });
  return series.map(({ editionRecords, editions, ...sr }) => ({ ...sr, editions: editionRecords.map((e) => ({ ...e, edition: e.slug, events: e._count.events })), directEvents: editions }));
}

const SERIES_STATUSES = ['draft', 'active', 'paused', 'archived'];
const VISIBILITIES = ['public', 'unlisted', 'private'];
const imageUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (!/^https:\/\/(upload|commons)\.wikimedia\.org\//.test(s)) throw new SeriesError('Images must come from Wikimedia Commons (https://upload.wikimedia.org/…).', 'logoUrl');
  return s.slice(0, 1000);
};
// Links, one per line: "Label | https://…" or just the address.
function parseLinks(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [a, b] = line.includes('|') ? line.split('|').map((x) => x.trim()) : [line, line];
    const url = b || a;
    if (!/^https?:\/\/\S+$/.test(url)) throw new SeriesError(`Not a web address: ${url}`, 'externalLinks');
    out.push({ label: (a || url).slice(0, 100), url: url.slice(0, 500) });
  }
  if (out.length > 20) throw new SeriesError('At most 20 links.', 'externalLinks');
  return out;
}

// The series' details. Fields not in the form (an inline edit sends only some) stay as they were.
async function update({ actorId, series, title, description, ...more }) {
  title = String(title || '').trim();
  if (!title) throw new SeriesError('Give the series a name.', 'title');
  const data = { title: title.slice(0, 120), description: String(description || '').trim().slice(0, 2000) };
  if (more.shortDescription !== undefined) data.shortDescription = String(more.shortDescription).trim().slice(0, 300);
  if (more.logoUrl !== undefined) data.logoUrl = imageUrl(more.logoUrl);
  if (more.bannerUrl !== undefined) data.bannerUrl = imageUrl(more.bannerUrl);
  if (more.defaultLanguage !== undefined) data.defaultLanguage = String(more.defaultLanguage).trim().toLowerCase().slice(0, 20);
  if (more.supportedLanguages !== undefined) data.supportedLanguages = JSON.stringify([...new Set(String(more.supportedLanguages).split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2,3}(-[a-z0-9]+)*$/.test(l)))].slice(0, 50));
  if (more.communities !== undefined) data.communities = String(more.communities).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100).join('\n');
  if (more.externalLinks !== undefined) data.externalLinks = JSON.stringify(parseLinks(more.externalLinks));
  if (more.visibility !== undefined) data.visibility = VISIBILITIES.includes(more.visibility) ? more.visibility : 'public';
  // Archiving has its own button (it archives the editions too); here: draft, active, paused.
  if (more.status !== undefined && ['draft', 'active', 'paused'].includes(more.status) && series.status !== 'archived') data.status = more.status;
  const updated = await prisma.eventSeries.update({ where: { id: series.id }, data });
  await audit.record({ actorId, action: 'series.updated', entityType: 'EventSeries', entityId: series.id, details: { slug: series.slug, title } });
  return updated;
}

// Only an empty series can go: no editions and no events directly under it.
async function remove({ actorId, series }) {
  const [editions, events] = await Promise.all([
    prisma.edition.count({ where: { seriesId: series.id, deletedAt: null } }),
    prisma.contest.count({ where: { seriesId: series.id, deletedAt: null } }),
  ]);
  if (editions || events) throw new SeriesError('A series with editions or events cannot be deleted; delete or move them first.');
  await prisma.$transaction([
    prisma.seriesSlug.deleteMany({ where: { seriesId: series.id } }),
    prisma.levelSetting.deleteMany({ where: { OR: [{ seriesId: series.id }, { edition: { seriesId: series.id } }] } }),
    prisma.scopeRole.deleteMany({ where: { OR: [{ seriesId: series.id }, { edition: { seriesId: series.id } }] } }),
    prisma.contest.updateMany({ where: { seriesId: series.id }, data: { seriesId: null } }),
    // Deleted events may still point at its (deleted) editions.
    prisma.contest.updateMany({ where: { editionOf: { seriesId: series.id } }, data: { editionId: null } }),
    prisma.edition.deleteMany({ where: { seriesId: series.id } }),
    prisma.eventSeries.delete({ where: { id: series.id } }),
  ]);
  await audit.record({ actorId, action: 'series.deleted', entityType: 'EventSeries', entityId: series.id, details: { slug: series.slug } });
}

// Across a series' editions (from summary(), any order): per edition, oldest first, how many
// took part and how many of them were new to the series; everyone's totals over all editions
// with the number of editions they took part in; and each finished edition's top three.
const FINISHED = ['completed', 'archived', 'under_review', 'submission_closed'];
const when = (e) => (e.startDate ? new Date(e.startDate).getTime() : 0) || (e.year ? Date.UTC(e.year, 0, 1) : 0) || Number.parseInt(e.slug, 10) || 0;
async function insights(editions, { leaders = 50 } = {}) {
  const chrono = [...editions].sort((a, b) => when(a) - when(b));
  const edOf = new Map();
  chrono.forEach((e) => e.events.forEach((ev) => edOf.set(ev.id, e.id)));
  const empty = { trend: [], leaders: [], fame: [] };
  if (!edOf.size) return empty;
  const { Prisma } = require('@prisma/client');
  const rows = await prisma.$queryRaw`
    SELECT s.participantId AS uid, s.contestId AS cid, COUNT(DISTINCT s.pageKey) AS entries,
           COUNT(DISTINCT CASE WHEN s.status = 'approved' THEN s.pageKey END) AS accepted,
           COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.wordCount ELSE 0 END), 0) AS words
    FROM Submission s WHERE s.contestId IN (${Prisma.join([...edOf.keys()])}) AND s.status <> 'withdrawn'
    GROUP BY s.participantId, s.contestId`;
  // person → edition → totals
  const per = new Map();
  for (const r of rows) {
    const uid = Number(r.uid);
    const ed = edOf.get(Number(r.cid));
    if (!per.has(uid)) per.set(uid, new Map());
    const m = per.get(uid);
    const t = m.get(ed) || { entries: 0, accepted: 0, words: 0 };
    t.entries += Number(r.entries); t.accepted += Number(r.accepted); t.words += Number(r.words);
    m.set(ed, t);
  }
  const seen = new Set();
  const trend = chrono.map((e) => {
    let total = 0;
    let fresh = 0;
    for (const [uid, m] of per) if (m.has(e.id)) { total += 1; if (!seen.has(uid)) fresh += 1; }
    for (const [uid, m] of per) if (m.has(e.id)) seen.add(uid);
    return { id: e.id, label: e.identifier || e.slug, total, fresh, returning: total - fresh, words: e.approvedWords || 0, entries: e.entries || 0 };
  });
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...per.keys()] } }, select: { id: true, username: true } })).map((u) => [u.id, u.username]));
  const all = [...per].map(([uid, m]) => {
    const sum = { username: names.get(uid) || '?', editions: m.size, entries: 0, accepted: 0, words: 0 };
    for (const t of m.values()) { sum.entries += t.entries; sum.accepted += t.accepted; sum.words += t.words; }
    return sum;
  });
  const byWords = all.some((p) => p.words) ? (a, b) => b.words - a.words || b.accepted - a.accepted : (a, b) => b.accepted - a.accepted || b.entries - a.entries;
  const fame = chrono.filter((e) => FINISHED.includes(e.status)).reverse().map((e) => {
    const top = [...per].filter(([, m]) => m.has(e.id)).map(([uid, m]) => ({ username: names.get(uid) || '?', ...m.get(e.id) }))
      .filter((p) => p.accepted > 0).sort(byWords).slice(0, 3);
    return { id: e.id, label: e.identifier || e.slug, title: e.title, slug: e.slug, top };
  }).filter((f) => f.top.length);
  return { trend, leaders: all.sort(byWords).slice(0, leaders), fame };
}

// An edition's event against the same event of the edition before (same address, else same wiki):
// who came back, who is new, who did not come back, and entries and accepted words on both sides.
async function compareWithPrevious(contest) {
  if (!contest.editionId) return null;
  const ed = await prisma.edition.findUnique({ where: { id: contest.editionId }, select: { id: true, seriesId: true, startDate: true, year: true, slug: true, identifier: true } });
  if (!ed) return null;
  const eds = await prisma.edition.findMany({ where: { seriesId: ed.seriesId, deletedAt: null, id: { not: ed.id } }, select: { id: true, startDate: true, year: true, slug: true, identifier: true } });
  const prev = eds.filter((e) => when(e) < when(ed)).sort((a, b) => when(b) - when(a))[0];
  if (!prev) return null;
  const cands = await prisma.contest.findMany({ where: { editionId: prev.id, deletedAt: null }, select: { id: true, slug: true, primaryWiki: true, title: true, path: true } });
  const before = cands.find((c) => c.slug === contest.slug) || cands.find((c) => c.primaryWiki === contest.primaryWiki);
  if (!before) return null;
  const side = async (cid) => {
    const rows = await prisma.submission.groupBy({ by: ['participantId'], where: { contestId: cid, status: { not: 'withdrawn' } }, _count: { _all: true } });
    const words = await prisma.submission.aggregate({ where: { contestId: cid, status: 'approved' }, _sum: { wordCount: true }, _count: { _all: true } });
    return { people: new Set(rows.map((r) => r.participantId)), entries: rows.reduce((a, r) => a + r._count._all, 0), accepted: words._count._all, words: words._sum.wordCount || 0 };
  };
  const [now, then] = await Promise.all([side(contest.id), side(before.id)]);
  const back = [...now.people].filter((id) => then.people.has(id));
  const fresh = [...now.people].filter((id) => !then.people.has(id));
  const gone = [...then.people].filter((id) => !now.people.has(id));
  const users = await prisma.user.findMany({ where: { id: { in: [...back, ...gone].slice(0, 400) } }, select: { id: true, username: true } });
  const name = new Map(users.map((u) => [u.id, u.username]));
  const names = (ids) => ids.map((id) => name.get(id)).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return {
    previous: { label: prev.identifier || prev.slug, title: before.title, path: before.path },
    now: { people: now.people.size, entries: now.entries, accepted: now.accepted, words: now.words },
    then: { people: then.people.size, entries: then.entries, accepted: then.accepted, words: then.words },
    back: back.length, fresh: fresh.length, gone: gone.length,
    backNames: names(back), goneNames: names(gone),
  };
}

// The edition to open for "/<series>/current": the featured one, else one that is running,
// else the next one coming, else the newest.
function currentOf(editions) {
  const chrono = [...editions].sort((a, b) => when(b) - when(a));
  return editions.find((e) => e.featured)
    || chrono.find((e) => e.status === 'active')
    || [...chrono].reverse().find((e) => ['upcoming', 'published'].includes(e.status))
    || chrono[0] || null;
}

module.exports = {
  insights, currentOf, when, compareWithPrevious,
  SERIES_STATUSES,
  VISIBILITIES, SeriesError, create, summary, nextEdition, createEdition, listAll, update, remove };
