// Stage 5: changing the structure. An event can be moved to another parent (a series, an
// edition, or none: detached), or copied into one as a draft; an edition can be copied with
// all its events; a series or an edition can be archived. Old addresses are not redirected.
// Who may do what is checked by the caller (scopeRoleService); these only keep the data right.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const editions = require('./editionService');
const inherit = require('./inheritService');

class StructureError extends Error {}

const DATE_KEYS = ['registrationOpensAt', 'startDate', 'endDate', 'submissionOpensAt', 'submissionDeadline', 'reviewOpensAt', 'reviewDeadline', 'appealDeadline', 'resultsAnnouncedAt'];
const shift = (d, years) => {
  if (!d || !years) return d || null;
  const n = new Date(d);
  n.setUTCFullYear(n.getUTCFullYear() + years);
  return n;
};
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

// target: { seriesId } | { editionId } | {} (no parent). Returns { seriesId, editionId }.
function parentOf(target) {
  if (target.editionId) return { seriesId: null, editionId: Number(target.editionId) };
  if (target.seriesId) return { seriesId: Number(target.seriesId), editionId: null };
  return { seriesId: null, editionId: null };
}

async function freeName(tx, wanted, parent, excludeId, type = null) {
  // A series holds one type of event.
  const seriesId = parent.seriesId || (parent.editionId && (await tx.edition.findUnique({ where: { id: parent.editionId }, select: { seriesId: true } })).seriesId);
  if (seriesId && type) {
    const theirs = await editions.seriesType(seriesId, { excludeId }, tx);
    if (theirs && theirs !== type) throw new StructureError('The events of this series are of another type.');
  }
  if (parent.editionId) {
    const has = await editions.eventOf(parent.editionId, { excludeId }, tx);
    if (has) throw new StructureError('This edition already has its event. Add the wikis to that event instead.');
  }
  if (!SLUG.test(wanted)) throw new StructureError('Use lowercase letters, numbers and hyphens for the name.');
  if (await editions.slugFree(wanted, { ...parent, type }, { excludeId }, tx)) return wanted;
  for (let i = 2; i < 100; i++) {
    const c = `${wanted.slice(0, 76)}-${i}`;
    if (await editions.slugFree(c, { ...parent, type }, { excludeId }, tx)) return c;
  }
  throw new StructureError('Could not find a free name there; choose one.');
}

// Move (or detach, with an empty target). Keeps its name when free under the new parent.
async function moveEvent({ actorId, contest, target, slug }) {
  const parent = parentOf(target);
  if (parent.seriesId === (contest.seriesId ?? null) && parent.editionId === (contest.editionId ?? null)) throw new StructureError('The event is already there.');
  return prisma.$transaction(async (tx) => {
    const name = await freeName(tx, slug || contest.slug, parent, contest.id, contest.type);
    await tx.contest.update({ where: { id: contest.id }, data: { ...parent, slug: name } });
    await editions.sync(contest.id, tx);
    // Under a new parent it takes that parent's locks, and defaults where it had no value of its own.
    await inherit.applyToEvent(contest.id, { actorId, adopt: true }, tx);
    const moved = await tx.contest.findUnique({ where: { id: contest.id } });
    await audit.record({ actorId, contestId: contest.id, action: parent.seriesId || parent.editionId ? 'contest.moved' : 'contest.detached', entityType: 'Contest', entityId: contest.id, details: { from: contest.path, to: moved.path } }, tx);
    return moved;
  });
}

// One event copied as a draft: settings, wikis, organizers and jury; dates shifted by `years`.
async function copyEventTx(tx, ev, { actorId, parent, slug, years = 0, rename = null }) {
  const { id, path, createdAt, updatedAt, status, statusMode, resultsPublishedAt, mergedIntoId, mergedWikiCode, settings, wikis, memberships, editionId, seriesId, deletedAt, deletedById, slug: oldSlug, ...rest } = ev;
  const { id: _sid, contestId: _cid, trackedAt: _t, ...copySettings } = settings || {};
  const name = await freeName(tx, slug || oldSlug, parent, null, ev.type);
  const people = new Map([[`${actorId}:organizer:`, { userId: actorId, role: 'organizer', wiki: '' }]]);
  for (const m of memberships || []) if (['organizer', 'jury'].includes(m.role) && m.status === 'active') people.set(`${m.userId}:${m.role}:${m.wiki}`, { userId: m.userId, role: m.role, wiki: m.wiki });
  const contest = await tx.contest.create({
    data: {
      ...rest,
      ...parent,
      ...Object.fromEntries(DATE_KEYS.map((k) => [k, shift(ev[k], years)])),
      slug: name,
      title: rename ? rename(ev.title) : ev.title,
      mainCategory: rename ? rename(ev.mainCategory || '') : ev.mainCategory,
      previousEditionUrl: years ? '' : ev.previousEditionUrl,
      status: 'draft',
      statusMode: 'auto',
      createdById: actorId,
      settings: { create: copySettings },
      wikis: { create: (wikis || []).map((w) => ({ wiki: w.wiki, code: w.code, status: w.status === 'pending' ? 'pending' : 'active', overrides: w.overrides })) },
      memberships: { create: [...people.values()].map((m) => ({ ...m, assignedById: actorId })) },
    },
  });
  await editions.sync(contest.id, tx);
  await inherit.applyToEvent(contest.id, { actorId }, tx);
  await audit.record({ actorId, contestId: contest.id, action: 'contest.created', entityType: 'Contest', entityId: contest.id, details: { title: contest.title, from: ev.path } }, tx);
  return contest;
}

const COPY_INCLUDE = { settings: true, wikis: true, memberships: true };

async function copyEvent({ actorId, contest, target, slug }) {
  const ev = await prisma.contest.findUnique({ where: { id: contest.id }, include: COPY_INCLUDE });
  return prisma.$transaction(async (tx) => {
    const copy = await copyEventTx(tx, ev, { actorId, parent: parentOf(target), slug });
    return tx.contest.findUnique({ where: { id: copy.id } });
  });
}

// An edition copied with each of its events (drafts), its people and its settings for the
// events below. years: how far to move the dates (1 for next year's edition).
async function copyEdition({ actorId, edition, slug, title, years = 0 }) {
  slug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(slug)) throw new StructureError('Give the edition a short name, such as 2026.');
  const series = await prisma.eventSeries.findUnique({ where: { id: edition.seriesId } });
  if (await prisma.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: series.id, slug } } })) throw new StructureError(`/${series.slug}/${slug} already exists.`);
  const source = await prisma.edition.findUnique({ where: { id: edition.id }, include: { events: { where: { deletedAt: null }, include: COPY_INCLUDE } } });
  const rename = (s) => (s || '').split(source.slug).join(slug);
  return prisma.$transaction(async (tx) => {
    const created = await editions.findOrCreate(series.id, slug, { title: String(title || '').trim() || rename(source.title), startDate: shift(source.startDate, years), endDate: shift(source.endDate, years) }, tx);
    if (!created) throw new StructureError(`/${series.slug}/${slug} is already the address of an event of this series.`);
    await tx.edition.update({ where: { id: created.id }, data: { description: source.description || '', cycleType: source.cycleType, visibility: source.visibility, createdById: actorId || null, identifier: (source.identifier || '').includes(source.slug) ? rename(source.identifier) : slug } });
    // People and settings first, so the copied events follow the settings.
    const roles = await tx.scopeRole.findMany({ where: { editionId: source.id } });
    const keep = new Map([[`${actorId}:organizer`, { userId: actorId, role: 'organizer', appliesToChildren: false }], ...roles.map((r) => [`${r.userId}:${r.role}`, r])]);
    for (const r of keep.values()) await tx.scopeRole.create({ data: { userId: r.userId, role: r.role, editionId: created.id, appliesToChildren: r.appliesToChildren, assignedById: actorId } });
    for (const r of await tx.levelSetting.findMany({ where: { editionId: source.id } })) {
      await tx.levelSetting.create({ data: { editionId: created.id, key: r.key, value: r.value, mode: r.mode, updatedById: actorId } });
    }
    for (const ev of source.events) await copyEventTx(tx, ev, { actorId, parent: { seriesId: null, editionId: created.id }, years, rename });
    await audit.record({ actorId, action: 'edition.created', entityType: 'Edition', entityId: created.id, details: { series: series.slug, edition: slug, from: source.slug, events: source.events.length } }, tx);
    return created;
  });
}

// Archive a series or an edition: the level is marked archived, and so is every event below
// that has finished (completed or cancelled). Events still to come or running stop it.
async function archive({ actorId, level }) {
  const below = await prisma.contest.findMany({
    where: { deletedAt: null, ...(level.editionId ? { editionId: level.editionId } : { OR: [{ seriesId: level.seriesId }, { editionOf: { seriesId: level.seriesId } }] }) },
    select: { id: true, title: true, status: true },
  });
  const open = below.filter((c) => !['completed', 'cancelled', 'archived'].includes(c.status) && c.status !== 'draft');
  if (open.length) throw new StructureError(`These events have not finished yet: ${open.map((c) => c.title).join(', ')}. Finish or cancel them first.`);
  await prisma.$transaction(async (tx) => {
    for (const c of below.filter((x) => ['completed', 'cancelled'].includes(x.status))) {
      await tx.contest.update({ where: { id: c.id }, data: { status: 'archived', statusMode: 'manual' } });
      await audit.record({ actorId, contestId: c.id, action: 'contest.statusChanged', entityType: 'Contest', entityId: c.id, details: { from: c.status, to: 'archived', by: 'archived with its parent' } }, tx);
    }
    if (level.editionId) {
      await tx.edition.update({ where: { id: level.editionId }, data: { status: 'archived' } });
    } else {
      await tx.eventSeries.update({ where: { id: level.seriesId }, data: { status: 'archived' } });
      await tx.edition.updateMany({ where: { seriesId: level.seriesId, deletedAt: null }, data: { status: 'archived' } });
    }
    await audit.record({ actorId, action: 'level.archived', entityType: level.editionId ? 'Edition' : 'EventSeries', entityId: level.editionId || level.seriesId, details: { events: below.length } }, tx);
  });
}

// Deletes a series or an edition with everything in it (superusers): its events are deleted
// (soft, like any event, so their names are free again), then the edition(s), their settings and
// roles, and for a series the series itself.
// What is inside a series or an edition: what stops it from being deleted.
async function impact(level) {
  if (level.editionId) {
    const events = await prisma.contest.findMany({ where: { editionId: level.editionId, deletedAt: null }, select: { id: true, title: true, path: true, status: true } });
    return { editions: [], directEvents: [], editionEvents: events, blocked: events.length > 0 };
  }
  const [editionsIn, directEvents] = await Promise.all([
    prisma.edition.findMany({ where: { seriesId: level.seriesId, deletedAt: null }, select: { id: true, slug: true, identifier: true, title: true, _count: { select: { events: { where: { deletedAt: null } } } } } }),
    prisma.contest.findMany({ where: { seriesId: level.seriesId, deletedAt: null }, select: { id: true, title: true, path: true, status: true } }),
  ]);
  return { editions: editionsIn, directEvents, editionEvents: [], blocked: editionsIn.length > 0 || directEvents.length > 0 };
}

// Deleting is refused while anything is inside (move, detach or delete those first). Then it is a
// soft delete: the row stays (with its people and settings) and can be restored; its address is freed.
async function deleteLevel({ actorId, level }) {
  const inside = await impact(level);
  if (inside.blocked) {
    throw new StructureError(level.editionId
      ? 'This edition still has an event. Move it, make it standalone, or delete it first.'
      : 'This series still has editions or events. Move, detach or delete them first.');
  }
  return prisma.$transaction(async (tx) => {
    if (level.editionId) {
      const e = await tx.edition.findUnique({ where: { id: level.editionId }, include: { series: true } });
      await tx.seriesSlug.deleteMany({ where: { editionId: e.id } });
      await tx.edition.update({ where: { id: e.id }, data: { deletedAt: new Date(), originalSlug: e.slug, slug: `~${e.id}-${e.slug}`.slice(0, 190) } });
      await audit.record({ actorId, action: 'edition.deleted', entityType: 'Edition', entityId: e.id, details: { series: e.series.slug, edition: e.slug } }, tx);
      return { kind: 'edition', series: e.series };
    }
    const sr = await tx.eventSeries.findUnique({ where: { id: level.seriesId } });
    await tx.eventSeries.update({ where: { id: sr.id }, data: { deletedAt: new Date(), originalSlug: sr.slug, slug: `~${sr.id}-${sr.slug}`.slice(0, 190) } });
    await audit.record({ actorId, action: 'series.deleted', entityType: 'EventSeries', entityId: sr.id, details: { slug: sr.slug } }, tx);
    return { kind: 'series' };
  });
}

// Deleted series and editions, for those who may restore or purge them.
async function deletedLevels() {
  const [series, editionsList] = await Promise.all([
    prisma.eventSeries.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' }, select: { id: true, title: true, originalSlug: true, deletedAt: true } }),
    prisma.edition.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' }, select: { id: true, title: true, identifier: true, originalSlug: true, deletedAt: true, series: { select: { slug: true, title: true, deletedAt: true } } } }),
  ]);
  return { series, editions: editionsList };
}

// Back from deletion, at its old address if that is still free.
async function restoreLevel({ actorId, kind, id }) {
  const { RESERVED } = require('../middleware/permissions');
  return prisma.$transaction(async (tx) => {
    if (kind === 'edition') {
      const e = await tx.edition.findUnique({ where: { id }, include: { series: true } });
      if (!e || !e.deletedAt) throw new StructureError('Nothing to restore.');
      if (e.series.deletedAt) throw new StructureError('Restore its series first.');
      const slug = e.originalSlug || e.slug;
      if (await tx.seriesSlug.findUnique({ where: { seriesId_slug: { seriesId: e.seriesId, slug } } })) throw new StructureError(`/${e.series.slug}/${slug} is taken now; free it first.`);
      await tx.edition.update({ where: { id }, data: { deletedAt: null, slug, originalSlug: null } });
      await tx.seriesSlug.create({ data: { seriesId: e.seriesId, slug, editionId: id } });
      await audit.record({ actorId, action: 'edition.restored', entityType: 'Edition', entityId: id, details: { series: e.series.slug, edition: slug } }, tx);
      return `/series/${e.series.slug}/${slug}`;
    }
    const sr = await tx.eventSeries.findUnique({ where: { id } });
    if (!sr || !sr.deletedAt) throw new StructureError('Nothing to restore.');
    const slug = sr.originalSlug || sr.slug;
    if (RESERVED.has(slug) || (await tx.eventSeries.findFirst({ where: { slug, NOT: { id } } })) || (await tx.contest.findFirst({ where: { path: `/${slug}`, deletedAt: null }, select: { id: true } }))) {
      throw new StructureError(`/${slug} is taken now; free it first.`);
    }
    await tx.eventSeries.update({ where: { id }, data: { deletedAt: null, slug, originalSlug: null } });
    await audit.record({ actorId, action: 'series.restored', entityType: 'EventSeries', entityId: id, details: { slug } }, tx);
    return `/${slug}`;
  });
}

// Gone for good: only something already deleted (and, for a series, with no editions left).
async function purgeLevel({ actorId, kind, id }) {
  return prisma.$transaction(async (tx) => {
    if (kind === 'edition') {
      const e = await tx.edition.findUnique({ where: { id } });
      if (!e || !e.deletedAt) throw new StructureError('Only a deleted edition can be removed for good.');
      if (await tx.contest.count({ where: { editionId: id } })) throw new StructureError('Deleted events still point at this edition; remove them for good first.');
      await tx.levelSetting.deleteMany({ where: { editionId: id } });
      await tx.scopeRole.deleteMany({ where: { editionId: id } });
      await tx.seriesSlug.deleteMany({ where: { editionId: id } });
      await tx.edition.delete({ where: { id } });
      await audit.record({ actorId, action: 'edition.purged', entityType: 'Edition', entityId: id, details: { slug: e.originalSlug || e.slug } }, tx);
      return;
    }
    const sr = await tx.eventSeries.findUnique({ where: { id } });
    if (!sr || !sr.deletedAt) throw new StructureError('Only a deleted series can be removed for good.');
    if (await tx.edition.count({ where: { seriesId: id } })) throw new StructureError('Its deleted editions are still kept; remove them for good first.');
    if (await tx.contest.count({ where: { seriesId: id } })) throw new StructureError('Deleted events still point at this series; remove them for good first.');
    await tx.levelSetting.deleteMany({ where: { seriesId: id } });
    await tx.scopeRole.deleteMany({ where: { seriesId: id } });
    await tx.seriesSlug.deleteMany({ where: { seriesId: id } });
    await tx.eventSeries.delete({ where: { id } });
    await audit.record({ actorId, action: 'series.purged', entityType: 'EventSeries', entityId: id, details: { slug: sr.originalSlug || sr.slug } }, tx);
  });
}

// Back from the archive: the level (a series with its editions); events stay archived until reopened one by one.
async function unarchive({ actorId, level }) {
  if (level.editionId) await prisma.edition.update({ where: { id: level.editionId }, data: { status: 'completed' } });
  else {
    // The editions archived with the series come back with it.
    await prisma.eventSeries.update({ where: { id: level.seriesId }, data: { status: 'active' } });
    await prisma.edition.updateMany({ where: { seriesId: level.seriesId, status: 'archived', deletedAt: null }, data: { status: 'completed' } });
  }
  await audit.record({ actorId, action: 'level.unarchived', entityType: level.editionId ? 'Edition' : 'EventSeries', entityId: level.editionId || level.seriesId });
}

module.exports = {
  impact,
  deletedLevels,
  restoreLevel,
  purgeLevel, StructureError, parentOf, moveEvent, copyEvent, copyEdition, archive, unarchive, deleteLevel, DATE_KEYS };
