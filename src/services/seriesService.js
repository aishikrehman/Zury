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
  if (await prisma.eventSeries.findUnique({ where: { slug } })) {
    throw new SeriesError(`/${slug} is already taken.`, 'slug');
  }
  const series = await prisma.eventSeries.create({ data: { slug, title, description: String(description).trim().slice(0, 2000) } });
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
    where: { seriesId, deletedAt: null },
    orderBy: [{ year: 'desc' }, { slug: 'desc' }],
    select: {
      id: true, slug: true, title: true, status: true, startDate: true, endDate: true,
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
  if (await prisma.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: series.id, slug } } })) throw new SeriesError(`/${series.slug}/${slug} already exists.`, 'edition');
  if (startDate && endDate && endDate < startDate) throw new SeriesError('The end date must be after the start date.', 'endDate');
  const edition = await editionService.findOrCreate(series.id, slug, { title: String(title || '').trim() || `${series.title} ${slug}`, startDate, endDate });
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

async function update({ actorId, series, title, description }) {
  title = String(title || '').trim();
  if (!title) throw new SeriesError('Give the series a name.', 'title');
  const updated = await prisma.eventSeries.update({ where: { id: series.id }, data: { title: title.slice(0, 120), description: String(description || '').trim().slice(0, 2000) } });
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

module.exports = { SeriesError, create, summary, nextEdition, createEdition, listAll, update, remove };
