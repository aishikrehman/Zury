// Where an event sits, and so its address. An event has at most one parent: a series directly
// (/<series>/<slug>), an edition (/<series>/<edition>: an edition has one event, at its own
// address; the edition's own pages are at /series/<series>/<edition>), or none: a standalone event
// at the top (/<slug>), sharing those names with the series.
// The address is worked out from that parent and stored, so every page resolves an event by
// one lookup and nothing is guessed from the shape of an address.
const prisma = require('../config/prisma');

// Names that can't be a standalone event's slug (they are pages under /events).
const EVENTS_RESERVED = new Set(['active', 'upcoming', 'completed', 'create', 'import']);

// Names that can't sit right under an event: its own pages.
const EVENT_TABS = new Set([
  'config', 'submissions', 'submit', 'results', 'tracking', 'participants', 'assignments', 'appeals', 'activity',
  'sessions', 'review', 'message', 'export', 'data', 'delete', 'move', 'status', 'join', 'leave', 'wikis', 'fountain',
  'members', 'overrides', 'blocks', 'statistics', 'certificate',
]);

// The address for an event with this slug under this parent ({ seriesId } or { editionId } or neither).
// selfId: the event itself. An edition's event takes the edition's address; an older edition that
// already holds several keeps the others under it (/<series>/<edition>/<slug>).
async function pathFor(slug, { seriesId = null, editionId = null } = {}, client = prisma, selfId = null) {
  if (editionId) {
    const e = await client.edition.findUnique({ where: { id: editionId }, select: { slug: true, series: { select: { slug: true } } } });
    if (!e) return null;
    const base = `/${e.series.slug}/${e.slug}`;
    const holder = await client.contest.findFirst({ where: { path: base, deletedAt: null, ...(selfId && { NOT: { id: selfId } }) }, select: { id: true } });
    return holder ? `${base}/${slug}` : base;
  }
  if (seriesId) {
    const s = await client.eventSeries.findUnique({ where: { id: seriesId }, select: { slug: true } });
    return s ? `/${s.slug}/${slug}` : null;
  }
  return `/${slug}`;
}

// Whether this slug is free under this parent; excludeId is the event itself when it's renamed.
async function slugFree(slug, parent, { excludeId = null } = {}, client = prisma) {
  // A standalone event's name is a top-level address: not one of Zury's pages, not a series.
  if (!parent.seriesId && !parent.editionId) {
    const { RESERVED } = require('../middleware/permissions');
    if (RESERVED.has(slug) || EVENTS_RESERVED.has(slug)) return false;
    if (await client.eventSeries.findUnique({ where: { slug }, select: { id: true } })) return false;
  }
  const path = await pathFor(slug, parent, client);
  const taken = await client.contest.findFirst({ where: { path, ...(excludeId && { NOT: { id: excludeId } }) }, select: { id: true } });
  if (taken) return false;
  // Directly under a series, an event shares the names with the series' editions.
  if (parent.seriesId) {
    const entry = await client.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: parent.seriesId, slug } } });
    if (entry && entry.contestId !== excludeId) return false;
  }
  return true;
}

// After an event is created, moved, renamed or deleted: its stored address, and its name
// entry under the series when it sits there directly.
async function sync(contestId, client = prisma) {
  const c = await client.contest.findUnique({ where: { id: contestId }, select: { id: true, slug: true, type: true, seriesId: true, editionId: true, deletedAt: true } });
  if (!c) return null;
  await client.seriesSlug.deleteMany({ where: { contestId: c.id, ...(c.seriesId && !c.deletedAt && { NOT: { seriesId: c.seriesId, slug: c.slug } }) } });
  const path = c.deletedAt ? null : await pathFor(c.slug, c, client, c.id);
  await client.contest.update({ where: { id: c.id }, data: { path } });
  if (c.seriesId && !c.deletedAt) {
    await client.seriesSlug.upsert({
      where: { seriesId_slug: { seriesId: c.seriesId, slug: c.slug } },
      update: {},
      create: { seriesId: c.seriesId, slug: c.slug, contestId: c.id },
    });
  }
  return path;
}

// An edition of a series by its name, made when missing (an empty edition is fine).
async function findOrCreate(seriesId, slug, { title, startDate = null, endDate = null } = {}, client = prisma) {
  const found = await client.edition.findUnique({ where: { seriesId_slug: { seriesId, slug } } });
  if (found) return found;
  const clash = await client.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId, slug } } });
  if (clash) return null; // a direct event of the series already has this name
  const edition = await client.edition.create({
    data: { seriesId, slug, title: title || slug, year: /^\d{4}$/.test(slug) ? Number(slug) : null, startDate, endDate },
  });
  await client.seriesSlug.create({ data: { seriesId, slug, editionId: edition.id } });
  return edition;
}

// The type of a series' events (its first live event's), or null when it has none yet.
async function seriesType(seriesId, { excludeId = null } = {}, client = prisma) {
  const c = await client.contest.findFirst({
    where: { deletedAt: null, OR: [{ seriesId }, { editionOf: { seriesId } }], ...(excludeId && { NOT: { id: excludeId } }) },
    orderBy: { id: 'asc' },
    select: { type: true },
  });
  return c ? c.type : null;
}

// The live event an edition already has (other than excludeId), if any.
function eventOf(editionId, { excludeId = null } = {}, client = prisma) {
  return client.contest.findFirst({ where: { editionId, deletedAt: null, ...(excludeId && { NOT: { id: excludeId } }) }, select: { id: true, title: true, path: true } });
}

module.exports = { pathFor, slugFree, sync, findOrCreate, eventOf, seriesType, EVENTS_RESERVED, EVENT_TABS };
