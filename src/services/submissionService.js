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

async function activeKeys(contestId, client = prisma) {
  const rows = await client.submission.findMany({ where: { contestId, status: { notIn: INACTIVE } }, select: { pageKey: true } });
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
  const [existing, count] = await Promise.all([activeKeys(contest.id), activeCount(contest.id, participantId)]);

  const looked = await mapLimit(lines, 4, async (input) => {
    const ref = parseEntry(input, defaultWiki || contest.primaryWiki);
    if (ref.error) return { input, error: ref.error };
    try {
      return { input, meta: await fetchEntryMetadata(ref, { language: contest.language }) };
    } catch (err) {
      if (err instanceof WikiApiError) return { input, error: `Could not check this entry: ${err.message}` };
      throw err;
    }
  });

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
  const valid = items.filter((i) => i.ok);
  if (!valid.length) throw new SubmissionError('None of these entries can be submitted.');
  return prisma.$transaction(async (tx) => {
    if (ensureParticipant) await ensureParticipant(tx);
    // Re-check inside the transaction in case someone else submitted meanwhile.
    const keys = await activeKeys(contest.id, tx);
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
};

async function list({ contestId, user, can, status, q, mine, wiki, sort = 'submitted', dir = 'desc', page = 1, perPage = 25 }) {
  let base = visibilityWhere({ contestId, user, can });
  if (!base) return { items: [], total: 0, page, perPage, counts: {} };
  if (wiki) base = { AND: [base, { wiki }] };
  const where = { AND: [base] };
  if (STATUSES.includes(status)) where.AND.push({ status });
  if (q) where.AND.push({ title: { contains: q } });
  if (mine && user) where.AND.push({ participantId: user.id });
  const [items, total, grouped] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: [...(SORTS[sort] || SORTS.submitted)(dir === 'asc' ? 'asc' : 'desc'), { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { participant: { select: { username: true } } },
    }),
    prisma.submission.count({ where }),
    prisma.submission.groupBy({ by: ['status'], where: base, _count: true }),
  ]);
  return { items, total, page, perPage, counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])) };
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
  const meta = await fetchEntryMetadata({ wiki: submission.wiki, title: submission.title }, { language: contest.language });
  const eventWiki = eventWikis.find((w) => w.wiki === submission.wiki);
  const eff = effectiveFor(contest, settings, eventWiki);
  const others = await activeKeys(contest.id);
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
        validation: JSON.stringify({ errors, warnings: result.warnings }),
        checkedAt: new Date(),
        status,
        history: { create: { actorId: actor.id, action: 'revalidated', previousValue: submission.status, newValue: status, note: errors.length ? errors.join(' ') : 'All checks passed.' } },
      },
    });
    return updated;
  });
}

function listMine(userId) {
  return prisma.submission.findMany({
    where: { participantId: userId, contest: { deletedAt: null } },
    orderBy: { submittedAt: 'desc' },
    take: 200,
    include: { contest: { select: { id: true, title: true, status: true } } },
  });
}

module.exports = { SORTS,
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
