const prisma = require('../config/prisma');
const audit = require('./auditService');
const editions = require('./editionService');
const lifecycle = require('./lifecycleService');
const inherit = require('./inheritService');
const { defaultSettings } = require('./contestFormService');
const { defaultCode } = require('./eventWikiService');

class EventError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

// A free slug under this parent; with auto, -2, -3 … is tried until one is free.
async function uniqueSlug(tx, slug, { auto, excludeId, parent = {} }) {
  if (await editions.slugFree(slug, parent, { excludeId }, tx)) return slug;
  if (!auto) throw new EventError('This slug is already used here.', 'slug');
  for (let i = 2; i < 100; i++) {
    const candidate = `${slug.slice(0, 76)}-${i}`;
    if (await editions.slugFree(candidate, parent, { excludeId }, tx)) return candidate;
  }
  throw new EventError('Could not find a free slug; please choose one.', 'slug');
}

// The event's parent from the form's "Part of" (a series) and edition: the edition when one
// is given (made if missing; it may hold other events), else the series directly, else none.
async function seriesFields(tx, series, title, actorId = null, selfId = null, type = null) {
  if (!series) return { seriesId: null, editionId: null };
  let row = await tx.eventSeries.findUnique({ where: { slug: series.slug } });
  // A series holds one type of event.
  if (row && type) {
    const theirs = await editions.seriesType(row.id, { excludeId: selfId }, tx);
    if (theirs && theirs !== type) throw new EventError('The events of this series are of another type. Choose that type, or another series.', 'seriesSlug');
  }
  if (!row) {
    row = await tx.eventSeries.create({ data: { slug: series.slug, title: series.title || title.replace(/\s*(19|20)\d\d\s*/g, ' ').trim() || title } });
    // A new series is run by whoever made it (that level only).
    if (actorId) await tx.scopeRole.create({ data: { userId: actorId, role: 'organizer', seriesId: row.id, assignedById: actorId } });
  }
  if (!series.edition) return { seriesId: row.id, editionId: null };
  const existed = await tx.edition.findUnique({ where: { seriesId_slug: { seriesId: row.id, slug: series.edition } } });
  if (!existed) throw new EventError('Choose one of the series’ editions, or none. New editions are made on the series page.', 'edition');
  const edition = await editions.findOrCreate(row.id, series.edition, { title }, tx);
  if (edition && !existed && actorId) await tx.scopeRole.create({ data: { userId: actorId, role: 'organizer', editionId: edition.id, assignedById: actorId } });
  if (!edition) throw new EventError(`/${series.slug}/${series.edition} is already the address of an event of this series.`, 'edition');
  const has = await editions.eventOf(edition.id, { excludeId: selfId }, tx);
  if (has) throw new EventError('This edition already has its event. Add your wiki to that event instead.', 'edition');
  return { seriesId: null, editionId: edition.id };
}

async function create({ actorId, type, parsed, autoSlug }) {
  return prisma.$transaction(async (tx) => {
    const series = await seriesFields(tx, parsed.series, parsed.contest.title, actorId, null, type);
    const slug = await uniqueSlug(tx, parsed.contest.slug, { auto: autoSlug, parent: series });
    const contest = await tx.contest.create({
      data: {
        ...parsed.contest,
        ...series,
        slug,
        type,
        status: 'draft',
        createdById: actorId,
        settings: { create: { ...defaultSettings(type), ...parsed.settings } },
        memberships: { create: { userId: actorId, role: 'organizer', assignedById: actorId } },
        wikis: { create: { wiki: parsed.contest.primaryWiki, code: await defaultCode(parsed.contest.primaryWiki, tx) } },
      },
    });
    await audit.record({ actorId, contestId: contest.id, action: 'contest.created', entityType: 'Contest', entityId: contest.id, details: { title: contest.title, type } }, tx);
    await editions.sync(contest.id, tx);
    // A new event takes its series' and edition's settings (locked ones and defaults).
    await inherit.applyToEvent(contest.id, { actorId, fresh: true }, tx);
    return contest;
  });
}

function changedKeys(before, after) {
  return Object.keys(after).filter((k) => {
    const a = before?.[k];
    const b = after[k];
    return a instanceof Date || b instanceof Date ? a?.getTime?.() !== b?.getTime?.() : a !== b;
  });
}

async function update({ actorId, contest, settings, parsed, autoSlug }) {
  // Locked settings keep their value; a followed setting changed here becomes the event's own.
  parsed.lockedRefused = await inherit.guardUpdate(contest, settings, parsed.settings);
  return prisma.$transaction(async (tx) => {
    const parent = await seriesFields(tx, parsed.series, parsed.contest.title, actorId, contest.id, contest.type);
    const slug = await uniqueSlug(tx, parsed.contest.slug, { auto: autoSlug, excludeId: contest.id, parent });
    const data = { ...parsed.contest, ...parent, slug };
    const changed = [...changedKeys(contest, data), ...changedKeys(settings, parsed.settings).filter((k) => k !== 'followed').map((k) => `settings.${k}`)];
    if (!changed.length) return contest;

    const next = { ...contest, ...data };
    if (!lifecycle.STICKY_STATUSES.includes(contest.status) && contest.statusMode === 'auto') {
      data.status = lifecycle.computeAutoStatus(next, { ...settings, ...parsed.settings });
    }
    const updated = await tx.contest.update({
      where: { id: contest.id },
      data: {
        ...data,
        settings: { upsert: { create: { ...defaultSettings(contest.type), ...parsed.settings }, update: parsed.settings } },
      },
    });
    if (data.primaryWiki !== contest.primaryWiki) {
      const exists = await tx.contestWiki.findUnique({ where: { contestId_wiki: { contestId: contest.id, wiki: data.primaryWiki } } });
      if (!exists) await tx.contestWiki.create({ data: { contestId: contest.id, wiki: data.primaryWiki, code: await defaultCode(data.primaryWiki, tx) } });
    }
    await audit.record({ actorId, contestId: contest.id, action: 'contest.updated', entityType: 'Contest', entityId: contest.id, details: { changed } }, tx);
    if (data.status && data.status !== contest.status) {
      await audit.record(
        { actorId, contestId: contest.id, action: 'contest.statusChanged', entityType: 'Contest', entityId: contest.id, details: { from: contest.status, to: data.status, by: 'date change' } },
        tx,
      );
    }
    await editions.sync(updated.id, tx);
    // Moved under another series or edition: it takes that parent's settings.
    const moved = data.seriesId !== (contest.seriesId ?? null) || data.editionId !== (contest.editionId ?? null);
    if (moved) await inherit.applyToEvent(updated.id, { actorId, adopt: true }, tx);
    return updated;
  });
}

async function changeStatus({ actorId, contest, settings, action, status }) {
  const next = lifecycle.applyAction(contest, settings, { action, status });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.contest.update({ where: { id: contest.id }, data: next });
    await audit.record(
      { actorId, contestId: contest.id, action: 'contest.statusChanged', entityType: 'Contest', entityId: contest.id, details: { from: contest.status, to: next.status, mode: next.statusMode, action } },
      tx,
    );
    return updated;
  });
}

// Soft delete: the event disappears everywhere but stays in the database.
async function softDelete({ actorId, contest, confirmation }) {
  if (confirmation !== contest.slug) throw new EventError('Type the event slug exactly to confirm.', 'confirmation');
  return prisma.$transaction(async (tx) => {
    // A deleted event gives up its address (sync clears it), so a new event can take it.
    await tx.contest.update({ where: { id: contest.id }, data: { deletedAt: new Date(), deletedById: actorId, slug: `deleted-${contest.id}-${contest.slug}`.slice(0, 190) } });
    await audit.record({ actorId, contestId: contest.id, action: 'contest.deleted', entityType: 'Contest', entityId: contest.id, details: { title: contest.title, slug: contest.slug, path: contest.path } }, tx);
    await editions.sync(contest.id, tx);
  });
}

module.exports = { EventError, create, update, changeStatus, softDelete };
