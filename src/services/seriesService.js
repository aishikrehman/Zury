// Event series (/wam): every year's edition, a summary across the years, and the
// next edition made from the latest one.
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
const DATE_KEYS = ['registrationOpensAt', 'startDate', 'endDate', 'submissionOpensAt', 'submissionDeadline', 'reviewOpensAt', 'reviewDeadline', 'appealDeadline', 'resultsAnnouncedAt'];
const inAYear = (d) => {
  if (!d) return null;
  const n = new Date(d);
  n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

async function create({ actorId, slug, title, description = '' }) {
  slug = String(slug || '').trim().toLowerCase();
  title = String(title || '').trim();
  if (!title) throw new SeriesError('Give the series a name.', 'title');
  if (!SLUG.test(slug) || slug.length > 40) throw new SeriesError('Use lowercase letters, numbers and single hyphens (max 40).', 'slug');
  const { RESERVED } = require('../middleware/permissions');
  if (RESERVED.has(slug)) throw new SeriesError('That address is reserved.', 'slug');
  if ((await prisma.eventSeries.findUnique({ where: { slug } })) || (await prisma.contest.findFirst({ where: { slug, seriesId: null } }))) {
    throw new SeriesError(`/${slug} is already taken.`, 'slug');
  }
  const series = await prisma.eventSeries.create({ data: { slug, title, description: String(description).trim().slice(0, 2000) } });
  await audit.record({ actorId, action: 'series.created', entityType: 'EventSeries', entityId: series.id, details: { slug, title } });
  return series;
}

// Totals per edition, newest first: entries, accepted, people, wikis, words.
async function summary(seriesId) {
  const editions = await prisma.contest.findMany({
    where: { seriesId, deletedAt: null, status: { not: 'draft' } },
    orderBy: { edition: 'desc' },
    select: { id: true, edition: true, title: true, status: true, wikis: { where: { status: { not: 'pending' } }, select: { code: true, wiki: true } } },
  });
  const ids = editions.map((e) => e.id);
  const [entries, approved, people] = await Promise.all([
    prisma.submission.groupBy({ by: ['contestId'], where: { contestId: { in: ids }, status: { not: 'withdrawn' } }, _count: { _all: true }, _sum: { wordCount: true } }),
    prisma.submission.groupBy({ by: ['contestId'], where: { contestId: { in: ids }, status: 'approved' }, _count: { _all: true }, _sum: { wordCount: true } }),
    prisma.contestMembership.groupBy({ by: ['contestId'], where: { contestId: { in: ids }, role: 'participant', status: 'active' }, _count: { _all: true } }),
  ]);
  const of = (rows, id) => rows.find((r) => r.contestId === id);
  return editions.map((e) => ({
    ...e,
    entries: of(entries, e.id)?._count._all || 0,
    words: of(entries, e.id)?._sum.wordCount || 0,
    approved: of(approved, e.id)?._count._all || 0,
    approvedWords: of(approved, e.id)?._sum.wordCount || 0,
    participants: of(people, e.id)?._count._all || 0,
  }));
}

// The next edition: the latest one's settings, wikis, organizers and jury, a year later, as a draft.
async function nextEdition({ actorId, series }) {
  const latest = await prisma.contest.findFirst({
    where: { seriesId: series.id, deletedAt: null },
    orderBy: { edition: 'desc' },
    include: { settings: true, wikis: true, memberships: { where: { status: 'active', role: { in: ['organizer', 'jury'] } } } },
  });
  if (!latest) throw new SeriesError('This series has no edition to start from.');
  if (latest.status === 'draft') throw new SeriesError(`/${series.slug}/${latest.edition} is still a draft: publish it before making the next one.`);
  const year = Number.parseInt(latest.edition, 10);
  if (!Number.isFinite(year)) throw new SeriesError(`The latest edition (${latest.edition}) isn't a year; create the next one from the event form.`);
  const edition = String(year + 1);
  if (await prisma.contest.findFirst({ where: { seriesId: series.id, edition } })) throw new SeriesError(`/${series.slug}/${edition} already exists.`);

  const { id, slug, edition: _e, createdAt, updatedAt, status, statusMode, resultsPublishedAt, mergedIntoId, mergedWikiCode, settings, wikis, memberships, ...rest } = latest;
  const shift = Object.fromEntries(DATE_KEYS.map((k) => [k, inAYear(latest[k])]));
  const next = await prisma.$transaction(async (tx) => {
    const { id: _sid, contestId: _cid, trackedAt: _t, ...copySettings } = settings || {};
    const contest = await tx.contest.create({
      data: {
        ...rest,
        ...shift,
        slug: `${series.slug}-${edition}`,
        edition,
        title: latest.title.replace(String(year), edition),
        mainCategory: (latest.mainCategory || '').replace(String(year), edition),
        previousEditionUrl: '',
        status: 'draft',
        statusMode: 'auto',
        createdById: actorId,
        settings: { create: copySettings },
        wikis: { create: wikis.map((w) => ({ wiki: w.wiki, code: w.code, status: w.status === 'pending' ? 'pending' : 'active', overrides: w.overrides })) },
        memberships: { create: [...new Map([[`${actorId}:organizer:`, { userId: actorId, role: 'organizer', wiki: '' }], ...memberships.map((m) => [`${m.userId}:${m.role}:${m.wiki}`, { userId: m.userId, role: m.role, wiki: m.wiki }])]).values()].map((m) => ({ ...m, assignedById: actorId })) },
      },
    });
    await audit.record({ actorId, contestId: contest.id, action: 'contest.created', entityType: 'Contest', entityId: contest.id, details: { title: contest.title, from: `${series.slug}/${latest.edition}` } }, tx);
    return contest;
  });
  return next;
}

// Every series with its editions (newest first), for the management page.
async function listAll() {
  const series = await prisma.eventSeries.findMany({ orderBy: { title: 'asc' }, include: { editions: { where: { deletedAt: null }, orderBy: { edition: 'desc' }, select: { id: true, edition: true, title: true, status: true, startDate: true, wikis: { select: { code: true } } } } } });
  return series;
}

async function update({ actorId, series, title, description }) {
  title = String(title || '').trim();
  if (!title) throw new SeriesError('Give the series a name.', 'title');
  const updated = await prisma.eventSeries.update({ where: { id: series.id }, data: { title: title.slice(0, 120), description: String(description || '').trim().slice(0, 2000) } });
  await audit.record({ actorId, action: 'series.updated', entityType: 'EventSeries', entityId: series.id, details: { slug: series.slug, title } });
  return updated;
}

// Only a series without editions can go (editions keep their addresses through it).
async function remove({ actorId, series }) {
  const editions = await prisma.contest.count({ where: { seriesId: series.id } });
  if (editions) throw new SeriesError('A series with editions cannot be deleted; delete or move its editions first.');
  await prisma.eventSeries.delete({ where: { id: series.id } });
  await audit.record({ actorId, action: 'series.deleted', entityType: 'EventSeries', entityId: series.id, details: { slug: series.slug } });
}

module.exports = { SeriesError, create, summary, nextEdition, listAll, update, remove };
