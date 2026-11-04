const prisma = require('../config/prisma');
const audit = require('./auditService');
const lifecycle = require('./lifecycleService');
const { defaultSettings } = require('./contestFormService');
const { defaultCode } = require('./eventWikiService');

class EventError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

async function uniqueSlug(tx, slug, { auto, excludeId }) {
  const taken = async (s) => {
    const found =
      (await tx.contest.findUnique({ where: { slug: s }, select: { id: true } })) ||
      // Events without a series live at /<slug>, which must not be a series address.
      (await tx.eventSeries.findUnique({ where: { slug: s }, select: { id: true } }));
    return found && found.id !== excludeId;
  };
  if (!(await taken(slug))) return slug;
  if (!auto) throw new EventError('This slug is already used by another event.', 'slug');
  for (let i = 2; i < 100; i++) {
    const candidate = `${slug.slice(0, 76)}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new EventError('Could not find a free slug; please choose one.', 'slug');
}

// Resolves /<series>/<edition>: finds or creates the series and checks the edition is free.
async function seriesFields(tx, series, title, excludeId) {
  if (!series) return { seriesId: null, edition: null };
  let row = await tx.eventSeries.findUnique({ where: { slug: series.slug } });
  if (!row && (await tx.contest.findFirst({ where: { slug: series.slug, seriesId: null, id: excludeId ? { not: excludeId } : undefined }, select: { id: true } }))) {
    throw new EventError(`/${series.slug} is already the address of another event.`, 'seriesSlug');
  }
  if (!row) row = await tx.eventSeries.create({ data: { slug: series.slug, title: series.title || title.replace(/\s*(19|20)\d\d\s*/g, ' ').trim() || title } });
  const taken = await tx.contest.findFirst({ where: { seriesId: row.id, edition: series.edition, NOT: excludeId ? { id: excludeId } : undefined }, select: { id: true } });
  if (taken) throw new EventError(`/${series.slug}/${series.edition} is already used by another event.`, 'edition');
  return { seriesId: row.id, edition: series.edition };
}

async function create({ actorId, type, parsed, autoSlug }) {
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, parsed.contest.slug, { auto: autoSlug });
    const series = await seriesFields(tx, parsed.series, parsed.contest.title);
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
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, parsed.contest.slug, { auto: autoSlug, excludeId: contest.id });
    const data = { ...parsed.contest, ...(await seriesFields(tx, parsed.series, parsed.contest.title, contest.id)), slug };
    const changed = [...changedKeys(contest, data), ...changedKeys(settings, parsed.settings).map((k) => `settings.${k}`)];
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
    await tx.contest.update({ where: { id: contest.id }, data: { deletedAt: new Date(), deletedById: actorId } });
    await audit.record({ actorId, contestId: contest.id, action: 'contest.deleted', entityType: 'Contest', entityId: contest.id, details: { title: contest.title, slug: contest.slug } }, tx);
  });
}

module.exports = { EventError, create, update, changeStatus, softDelete };
