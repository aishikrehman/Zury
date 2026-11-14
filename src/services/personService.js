// One person's work in an event, or across an edition or a series: their entries, how they
// were decided, words, rank, the reviews they gave. Entries are public (as on Fountain); the
// reviewers' notes are shown to the person themself and to those who manage the event.
const prisma = require('../config/prisma');
const reviewService = require('./reviewService');
const { eventPath } = require('../utils/format');

const GROUP = { approved: 'accepted', rejected: 'rejected', disqualified: 'rejected', invalid: 'rejected', withdrawn: 'withdrawn' };
const groupOf = (s) => GROUP[s] || 'pending';

async function findPerson(username) {
  const name = String(username || '').replace(/_/g, ' ').trim();
  if (!name) return null;
  return prisma.user.findFirst({ where: { username: name, status: 'active' }, select: { id: true, username: true, homeWiki: true, lastLoginAt: true } });
}

// One event: everything about this person there. showNotes: their own page or an organizer.
async function inEvent({ contest, settings, person, showNotes }) {
  const [entries, roles, reviewsGiven, board] = await Promise.all([
    prisma.submission.findMany({
      where: { contestId: contest.id, participantId: person.id, status: { not: 'withdrawn' } },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, title: true, url: true, wiki: true, status: true, wordCount: true, submittedAt: true, reviews: { where: showNotes ? { comment: { not: '' } } : { id: -1 }, select: { comment: true, decision: true } } },
    }),
    prisma.contestMembership.findMany({ where: { contestId: contest.id, userId: person.id, status: 'active' }, select: { role: true, wiki: true, assignedAt: true } }),
    prisma.review.groupBy({ by: ['decision'], where: { contestId: contest.id, jurorId: person.id }, _count: { _all: true } }),
    reviewService.leaderboard({ contest, settings }).catch(() => []),
  ]);
  const count = (g) => entries.filter((e) => groupOf(e.status) === g).length;
  const words = (g) => entries.filter((e) => !g || groupOf(e.status) === g).reduce((a, e) => a + (e.wordCount || 0), 0);
  const row = board.find((r) => r.participantId === person.id);
  return {
    contest,
    path: eventPath(contest),
    roles: [...new Set(roles.map((r) => r.role))],
    since: roles.length ? roles.reduce((a, r) => (r.assignedAt < a ? r.assignedAt : a), roles[0].assignedAt) : null,
    entries: entries.map((e) => ({ ...e, group: groupOf(e.status), notes: ['accepted', 'rejected'].includes(groupOf(e.status)) ? e.reviews.map((r) => r.comment) : [] })),
    totals: { entries: entries.length, accepted: count('accepted'), pending: count('pending'), rejected: count('rejected'), words: words(), wordsAccepted: words('accepted') },
    // A rank only once something counts (everyone is tied at zero before that).
    rank: row && (row.points || row.words || row.entries) ? row.rank : null,
    ranked: board.length,
    byWords: !!board.byWords,
    reviews: { accept: reviewsGiven.find((r) => r.decision === 'accept')?._count._all || 0, reject: reviewsGiven.find((r) => r.decision === 'reject')?._count._all || 0 },
  };
}

// Several events (an edition or a series): one summary per event, and the totals.
async function across({ contests, person, showNotes }) {
  const list = [];
  for (const c of contests) {
    const settings = c.settings || (await prisma.contestSettings.findUnique({ where: { contestId: c.id } })) || {};
    const s = await inEvent({ contest: c, settings, person, showNotes });
    if (s.entries.length || s.roles.length || s.reviews.accept || s.reviews.reject) list.push(s);
  }
  const sum = (k) => list.reduce((a, s) => a + s.totals[k], 0);
  return {
    events: list,
    totals: { events: list.length, entries: sum('entries'), accepted: sum('accepted'), pending: sum('pending'), rejected: sum('rejected'), words: sum('words'), wordsAccepted: sum('wordsAccepted') },
    reviews: { accept: list.reduce((a, s) => a + s.reviews.accept, 0), reject: list.reduce((a, s) => a + s.reviews.reject, 0) },
  };
}

module.exports = { findPerson, inEvent, across, groupOf };
