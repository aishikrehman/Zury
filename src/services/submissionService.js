const prisma = require('../config/prisma');
const audit = require('./auditService');
const { parseEntry } = require('../wiki/wikiUrls');
const { fetchEntryMetadata } = require('../wiki/entryMetadata');
const { WikiApiError } = require('../wiki/wikiApi');
const { checkEntry, pageKeyFor, submissionWindow } = require('./submissionRules');
const { effectiveFor } = require('../events/effective');

const MAX_BATCH = 50;
const STATUSES = ['pending', 'validated', 'invalid', 'under_review', 'approved', 'rejected', 'disqualified', 'withdrawn', 'appealed'];
// Submissions in these states don't block a resubmission or count toward limits.
const INACTIVE = ['withdrawn', 'invalid'];
const WITHDRAWABLE = ['pending', 'validated', 'invalid', 'under_review'];

class SubmissionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// The keys already entered in the event; keys: only check these (big events have many entries).
async function activeKeys(contestId, client = prisma, keys = null) {
  if (keys && !keys.length) return new Set();
  const rows = await client.submission.findMany({ where: { contestId, status: { notIn: INACTIVE }, ...(keys && { pageKey: { in: keys } }) }, select: { pageKey: true } });
  return new Set(rows.map((r) => r.pageKey));
}

function activeCount(contestId, participantId, client = prisma) {
  return client.submission.count({ where: { contestId, participantId, status: { notIn: INACTIVE } } });
}

/**
 * Parses, looks up and checks each line. Saves nothing.
 * Every item gets ok=true/false, the reasons, and the status it would be saved with.
 */
/**
 * Parses, looks up and checks each line. Saves nothing.
 * Each entry is checked with the settings of its own wiki (event defaults plus
 * that wiki's overrides) and that wiki's submission window.
 * eventWikis: the event's active wikis; defaultWiki: used for plain titles.
 */
async function prepare({ contest, settings, participantId, text, eventWikis, defaultWiki, lateAllowed = false }) {
  const lines = splitLines(text);
  if (!lines.length) throw new SubmissionError('Enter at least one URL or title.');
  if (lines.length > MAX_BATCH) throw new SubmissionError(`At most ${MAX_BATCH} entries at a time.`);

  const wikis = eventWikis && eventWikis.length ? eventWikis : [{ wiki: contest.primaryWiki, overrides: '{}', status: 'active' }];
  const byWiki = new Map(wikis.map((w) => [w.wiki, w]));
  const count = await activeCount(contest.id, participantId);

  const looked = await mapLimit(lines, 4, async (input) => {
    const ref = parseEntry(input, defaultWiki || contest.primaryWiki);
    if (ref.error) return { input, error: ref.error };
    try {
      return { input, meta: await fetchEntryMetadata(ref, { language: contest.language, wordCountMethod: settings?.wordCountMethod }) };
    } catch (err) {
      if (err instanceof WikiApiError) return { input, error: `Could not check this entry: ${err.message}` };
      throw err;
    }
  });

  const existing = await activeKeys(contest.id, prisma, [...new Set(looked.filter((i) => i.meta).map((i) => pageKeyFor(i.meta)))]);
  const seen = new Set(existing);
  let accepted = count;
  return looked.map((item) => {
    if (item.error) return { ...item, ok: false, reasons: [item.error], warnings: [] };
    const eventWiki = byWiki.get(item.meta.wiki);
    if (!eventWiki) {
      return { ...item, ok: false, reasons: [`${item.meta.wiki} is not part of this event.`], warnings: [] };
    }
    const eff = effectiveFor(contest, settings, eventWiki);
    const window = submissionWindow(eff.contest);
    const result = checkEntry({
      meta: item.meta,
      contest: eff.contest,
      settings: eff.settings,
      typeConfig: eff.typeConfig,
      existingKeys: seen,
      entriesByParticipant: accepted,
      allowedWikis: [eventWiki.wiki],
    });
    if (!window.open && !lateAllowed) result.hard.unshift(`${eventWiki.code}: ${window.reason}`);
    const auto = eff.settings.autoValidationEnabled;
    const blocking = auto ? [...result.hard, ...result.rules] : result.hard;
    const warnings = auto ? result.warnings : [...result.rules, ...result.warnings];
    const ok = blocking.length === 0;
    if (ok) {
      seen.add(pageKeyFor(item.meta));
      accepted += 1;
    }
    return { ...item, ok, reasons: blocking, warnings, status: auto ? 'validated' : 'pending' };
  });
}

async function save({ actor, contest, settings, participant, items, ensureParticipant }) {
  const created = await saveEntries({ actor, contest, settings, participant, items, ensureParticipant });
  // Shared out to reviewers at once when the event does that automatically.
  await require('./reviewService').autoAssign({ contest, settings, ids: created.map((c) => c.id) }).catch((err) => console.error('Automatic assignment failed:', err.message));
  return created;
}

async function saveEntries({ actor, contest, settings, participant, items, ensureParticipant }) {
  const valid = items.filter((i) => i.ok);
  if (!valid.length) throw new SubmissionError('None of these entries can be submitted.');
  return prisma.$transaction(async (tx) => {
    if (ensureParticipant) await ensureParticipant(tx);
    // Re-check inside the transaction in case someone else submitted meanwhile.
    const keys = await activeKeys(contest.id, tx, valid.map((i) => pageKeyFor(i.meta)));
    const created = [];
    for (const item of valid) {
      const pageKey = pageKeyFor(item.meta);
      if (keys.has(pageKey)) continue;
      keys.add(pageKey);
      const submission = await tx.submission.create({
        data: {
          contestId: contest.id,
          participantId: participant.id,
          submittedById: actor.id,
          wiki: item.meta.wiki,
          title: item.meta.title,
          url: item.meta.url,
          pageKey,
          entryType: item.meta.entryType,
          status: item.status,
          metadata: JSON.stringify(item.meta),
          wordCount: item.meta?.wordCount ?? null,
          validation: JSON.stringify({ errors: [], warnings: item.warnings }),
          checkedAt: new Date(),
          history: {
            create: {
              actorId: actor.id,
              action: 'submitted',
              newValue: item.status,
              note: actor.id !== participant.id ? `Submitted on behalf of ${participant.username}` : null,
            },
          },
        },
      });
      created.push(submission);
    }
    if (created.length) {
      await audit.record(
        {
          actorId: actor.id,
          contestId: contest.id,
          action: 'submissions.created',
          entityType: 'User',
          entityId: participant.id,
          details: { count: created.length, participant: participant.username, onBehalf: actor.id !== participant.id },
        },
        tx,
      );
    }
    return created;
  });
}

// Who can see which submissions in an event.
function visibilityWhere({ contestId, user, can }) {
  if (can('viewAllSubmissions')) return { contestId };
  if (can('viewSubmissions')) return { contestId, OR: [{ status: { not: 'withdrawn' } }, ...(user ? [{ participantId: user.id }] : [])] };
  if (user) return { contestId, participantId: user.id };
  return null;
}

// wiki: limit to one wiki of a multi-wiki event.
// Columns the submissions table can be sorted by.
const SORTS = {
  title: (dir) => [{ title: dir }],
  participant: (dir) => [{ participant: { username: dir } }],
  status: (dir) => [{ status: dir }],
  submitted: (dir) => [{ submittedAt: dir }],
  words: (dir) => [{ wordCount: { sort: dir, nulls: 'last' } }],
};

async function list({ contestId, user, can, status, q, mine, participant, wiki, sort = 'submitted', dir = 'desc', page = 1, perPage = 25 }) {
  let base = visibilityWhere({ contestId, user, can });
  if (!base) return { items: [], total: 0, page, perPage, counts: {}, words: 0, participants: [] };
  if (wiki) base = { AND: [base, { wiki }] };
  const where = { AND: [base] };
  if (STATUSES.includes(status)) where.AND.push({ status });
  if (q) where.AND.push({ title: { contains: q } });
  if (mine && user) where.AND.push({ participantId: user.id });
  if (participant) where.AND.push({ participantId: participant });
  const [items, total, grouped, sums, byPerson] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: [...(SORTS[sort] || SORTS.submitted)(dir === 'asc' ? 'asc' : 'desc'), { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { participant: { select: { username: true } } },
    }),
    prisma.submission.count({ where }),
    prisma.submission.groupBy({ by: ['status'], where: base, _count: true }),
    prisma.submission.aggregate({ where, _sum: { wordCount: true } }),
    // Everyone with entries here, for the participant filter: entries and words each.
    prisma.submission.groupBy({ by: ['participantId'], where: base, _count: { _all: true }, _sum: { wordCount: true } }),
  ]);
  // Big events (Wikidata, lexemes) can have thousands of people: the filter lists the
  // busiest 300, plus whoever is picked; the rest are found through their name in the table.
  byPerson.sort((x, y) => y._count._all - x._count._all);
  const shown = byPerson.filter((g, i) => i < 300 || g.participantId === participant);
  const names = await prisma.user.findMany({ where: { id: { in: shown.map((g) => g.participantId) } }, select: { id: true, username: true } });
  const nameOf = Object.fromEntries(names.map((u) => [u.id, u.username]));
  const participants = shown
    .map((g) => ({ id: g.participantId, username: nameOf[g.participantId] || '?', entries: g._count._all, words: g._sum.wordCount || 0 }))
    .sort((a, b) => a.username.localeCompare(b.username));
  return { items, total, page, perPage, counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])), words: sums._sum.wordCount || 0, participants };
}

async function findVisible({ contestId, id, user, can, wiki }) {
  const base = visibilityWhere({ contestId, user, can });
  if (!base) return null;
  return prisma.submission.findFirst({
    where: { AND: [base, { id }, ...(wiki ? [{ wiki }] : [])] },
    include: {
      participant: { select: { id: true, username: true } },
      submittedBy: { select: { username: true } },
      history: { orderBy: { id: 'desc' }, include: { actor: { select: { username: true } } } },
    },
  });
}

async function changeStatus({ actor, submission, contestId, status, note, action = 'status_changed' }) {
  if (!STATUSES.includes(status)) throw new SubmissionError('Unknown status.');
  if (status === submission.status) return submission;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id: submission.id },
      data: {
        status,
        history: { create: { actorId: actor.id, action, previousValue: submission.status, newValue: status, note: note?.slice(0, 500) || null } },
      },
    });
    await audit.record(
      { actorId: actor.id, contestId, action: `submission.${action}`, entityType: 'Submission', entityId: submission.id, details: { title: submission.title, from: submission.status, to: status } },
      tx,
    );
    return updated;
  });
}

function withdraw({ actor, submission, contestId }) {
  if (submission.participantId !== actor.id) throw new SubmissionError('Only the participant can withdraw this entry.', 403);
  if (!WITHDRAWABLE.includes(submission.status)) throw new SubmissionError('This entry can no longer be withdrawn.');
  return changeStatus({ actor, submission, contestId, status: 'withdrawn', action: 'withdrawn' });
}

// Fetches fresh metadata and re-runs the rules. Decided outcomes
// (approved, rejected, …) are never changed automatically.
async function revalidate({ actor, submission, contest, settings, eventWikis = [] }) {
  const meta = await fetchEntryMetadata({ wiki: submission.wiki, title: submission.title }, { language: contest.language, wordCountMethod: settings?.wordCountMethod });
  const eventWiki = eventWikis.find((w) => w.wiki === submission.wiki);
  const eff = effectiveFor(contest, settings, eventWiki);
  const others = await activeKeys(contest.id, prisma, [pageKeyFor(meta)]);
  others.delete(submission.pageKey);
  const result = checkEntry({
    meta,
    contest: eff.contest,
    settings: eff.settings,
    typeConfig: eff.typeConfig,
    existingKeys: others,
    entriesByParticipant: 0,
    allowedWikis: eventWikis.length ? eventWikis.map((w) => w.wiki) : undefined,
  });
  const errors = [...result.hard, ...result.rules];
  let status = submission.status;
  if (eff.settings.autoValidationEnabled && ['pending', 'validated', 'invalid'].includes(status)) status = errors.length ? 'invalid' : 'validated';

  return prisma.$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id: submission.id },
      data: {
        metadata: JSON.stringify(meta.exists ? meta : { ...JSON.parse(submission.metadata), exists: false }),
        ...(meta.exists && { wordCount: meta.wordCount ?? null }),
        validation: JSON.stringify({ errors, warnings: result.warnings }),
        checkedAt: new Date(),
        status,
        history: { create: { actorId: actor.id, action: 'revalidated', previousValue: submission.status, newValue: status, note: errors.length ? errors.join(' ') : 'All checks passed.' } },
      },
    });
    return updated;
  });
}

// Someone's own entries across every event, with totals, filters and an order.
const MINE_SORTS = { newest: { submittedAt: 'desc' }, oldest: { submittedAt: 'asc' }, title: { title: 'asc' }, words: { wordCount: { sort: 'desc', nulls: 'last' } } };

async function listMine(userId, { status = '', contestId = null, q = '', sort = 'newest' } = {}) {
  const base = { participantId: userId, contest: { deletedAt: null } };
  const where = { ...base, ...(STATUSES.includes(status) && { status }), ...(contestId && { contestId }), ...(q && { title: { contains: q } }) };
  const [items, byStatus, words, events] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: [MINE_SORTS[sort] || MINE_SORTS.newest, { id: 'desc' }],
      take: 500,
      include: { contest: { select: { id: true, title: true, status: true, slug: true, path: true, series: { select: { slug: true } }, settings: { select: { wordCountEnabled: true } } } } },
    }),
    prisma.submission.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.submission.aggregate({ where: { ...base, status: 'approved' }, _sum: { wordCount: true } }),
    prisma.submission.groupBy({ by: ['contestId'], where: base, _count: { _all: true } }),
  ]);
  const titles = await prisma.contest.findMany({ where: { id: { in: events.map((e) => e.contestId) } }, select: { id: true, title: true } });
  const counts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
  return {
    items,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    approvedWords: words._sum.wordCount || 0,
    events: titles.map((c) => ({ ...c, count: events.find((e) => e.contestId === c.id)._count._all })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

module.exports = { SORTS, MINE_SORTS,
  MAX_BATCH,
  STATUSES,
  WITHDRAWABLE,
  SubmissionError,
  splitLines,
  prepare,
  save,
  list,
  findVisible,
  changeStatus,
  withdraw,
  revalidate,
  listMine,
};
