// Tracking: a Fountain editathon or a CampWiz campaign followed for its numbers, on a series, an
// edition or an event. Nothing is copied; the numbers are read when shown (and kept a while in memory).
const prisma = require('../config/prisma');

const LEVELS = ['series', 'edition', 'event', 'none']; // none: on its own (no event page; numbers only)
const KINDS = ['fountain', 'campwiz'];
class TrackerError extends Error {}

const list = (level, levelId) => prisma.tracker.findMany({ where: { level, levelId }, orderBy: { id: 'asc' } });

async function add({ level, levelId, kind, code, category, actorId }) {
  if (!LEVELS.includes(level) || !KINDS.includes(kind)) throw new TrackerError('Choose what to track.');
  code = String(code || '').trim().slice(0, 300);
  if (kind === 'fountain') {
    code = require('./fountainService').parseCode(code);
    if (!code) throw new TrackerError('Give the Fountain editathon code or link.');
    category = '';
  } else {
    category = require('./campwizService').categoryName(category).slice(0, 255);
    if (!require('./campwizService').campaignId(code) && !category) throw new TrackerError('Give the CampWiz campaign link or its Commons category.');
  }
  return prisma.tracker.create({ data: { level, levelId, kind, code, category: category || '', createdById: actorId || null } });
}

const remove = (id, level, levelId) => prisma.tracker.deleteMany({ where: { id, level, levelId } });

// Each tracker with its numbers; waits at most 4 seconds (a slow first read finishes in the background).
async function withNumbers(trackers) {
  const read = (t) => (t.kind === 'fountain'
    ? require('./fountainService').trackedStats(t.code)
    : require('./campwizService').tracked({ url: t.code, category: t.category }));
  return Promise.all(trackers.map((t) => Promise.race([
    read(t).then((data) => ({ ...t, data })).catch(() => ({ ...t, failed: true })),
    new Promise((ok) => setTimeout(() => ok({ ...t, pending: true }), 4000)),
  ])));
}

module.exports = { list, add, remove, withNumbers, TrackerError, LEVELS };
