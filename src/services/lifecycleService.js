const prisma = require('../config/prisma');
const audit = require('./auditService');

// Statuses the dates can produce once an event is published.
const AUTO_STATUSES = ['published', 'upcoming', 'active', 'submission_closed', 'under_review', 'completed'];
// Statuses only a person can set; the sweep never moves an event out of them.
const STICKY_STATUSES = ['draft', 'cancelled', 'archived'];

class LifecycleError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function computeAutoStatus(contest, settings, now = new Date()) {
  const { startDate, endDate } = contest;
  if (!startDate || !endDate) return 'published';
  if (now < startDate) return 'upcoming';
  const submissionEnd = contest.submissionDeadline || endDate;
  if (now < submissionEnd) return 'active';
  if (settings?.juryReviewEnabled ?? true) {
    const reviewEnd = contest.reviewDeadline || contest.resultsAnnouncedAt;
    if (!reviewEnd) return 'under_review';
    if (now < reviewEnd) return contest.reviewOpensAt && now < contest.reviewOpensAt ? 'submission_closed' : 'under_review';
    return 'completed';
  }
  return now < endDate ? 'submission_closed' : 'completed';
}

// The status an event should have now, given its mode.
function effectiveStatus(contest, settings, now = new Date()) {
  if (STICKY_STATUSES.includes(contest.status) || contest.statusMode === 'manual') return contest.status;
  return computeAutoStatus(contest, settings, now);
}

// Returns { status, statusMode } for an action, or throws LifecycleError.
function applyAction(contest, settings, { action, status }, now = new Date()) {
  const current = contest.status;
  switch (action) {
    case 'publish':
      if (current !== 'draft') throw new LifecycleError('Only drafts can be published.');
      if (!contest.startDate || !contest.endDate) throw new LifecycleError('Set the start and end dates before publishing.');
      return { status: computeAutoStatus(contest, settings, now), statusMode: 'auto' };
    case 'unpublish':
      if (!['published', 'upcoming'].includes(current)) throw new LifecycleError('Only events that have not started can go back to draft.');
      return { status: 'draft', statusMode: 'auto' };
    case 'set_status':
      if (STICKY_STATUSES.includes(current)) throw new LifecycleError('Publish or reopen the event first.');
      if (!AUTO_STATUSES.includes(status) || status === 'published') throw new LifecycleError('Choose a valid status.');
      return { status, statusMode: 'manual' };
    case 'resume_auto':
      if (STICKY_STATUSES.includes(current)) throw new LifecycleError('This event is not published.');
      return { status: computeAutoStatus(contest, settings, now), statusMode: 'auto' };
    case 'cancel':
      if (['cancelled', 'archived'].includes(current)) throw new LifecycleError('This event is already closed.');
      return { status: 'cancelled', statusMode: 'manual' };
    case 'reopen':
      if (current !== 'cancelled') throw new LifecycleError('Only cancelled events can be reopened.');
      return { status: 'draft', statusMode: 'auto' };
    case 'archive':
      if (!['completed', 'cancelled'].includes(current)) throw new LifecycleError('Only completed or cancelled events can be archived.');
      return { status: 'archived', statusMode: 'manual' };
    default:
      throw new LifecycleError('Unknown action.');
  }
}

// Brings auto-mode events in line with their dates. Safe to run any time.
async function refreshStatuses(now = new Date()) {
  const candidates = await prisma.contest.findMany({
    where: { deletedAt: null, statusMode: 'auto', status: { notIn: STICKY_STATUSES } },
    include: { settings: { select: { juryReviewEnabled: true } } },
  });
  let changed = 0;
  for (const c of candidates) {
    const next = computeAutoStatus(c, c.settings, now);
    if (next === c.status) continue;
    await prisma.$transaction(async (tx) => {
      // Only update if nobody changed the status since we read it.
      const { count } = await tx.contest.updateMany({ where: { id: c.id, status: c.status, statusMode: 'auto' }, data: { status: next } });
      if (count) {
        await audit.record(
          { contestId: c.id, action: 'contest.statusChanged', entityType: 'Contest', entityId: c.id, details: { from: c.status, to: next, by: 'schedule' } },
          tx,
        );
      }
    });
    changed += 1;
  }
  return changed;
}

module.exports = { AUTO_STATUSES, STICKY_STATUSES, LifecycleError, computeAutoStatus, effectiveStatus, applyAction, refreshStatuses };
