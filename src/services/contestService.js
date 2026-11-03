const prisma = require('../config/prisma');
const { STATUS_GROUPS, CONTEST_TYPES } = require('../utils/contestLabels');

const PUBLIC_WHERE = { visibility: 'public', status: { not: 'draft' }, deletedAt: null };
const SORTS = {
  newest: [{ startDate: 'desc' }, { id: 'desc' }],
  soonest: [{ startDate: 'asc' }, { id: 'asc' }],
  title: [{ title: 'asc' }],
};

// Draft and private events are visible only to their members and to those
// with management authority over them (platform roles, local admins).
function isVisible(contest, scope) {
  if (contest.visibility === 'public' && contest.status !== 'draft') return true;
  return scope.eventRoles.length > 0 || scope.permissions.has('manageEvent');
}

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  status: true,
  visibility: true,
  primaryWiki: true,
  timezone: true,
  startDate: true,
  endDate: true,
  _count: { select: { memberships: { where: { role: 'participant', status: 'active' } } } },
};

function listByGroup(group, take = 6) {
  return prisma.contest.findMany({
    where: { ...PUBLIC_WHERE, status: { in: STATUS_GROUPS[group] } },
    orderBy: group === 'completed' ? { endDate: 'desc' } : { startDate: 'asc' },
    select: CARD_SELECT,
    take,
  });
}

async function listPublic({ group, type, wiki, q, sort, page = 1, perPage = 12 }) {
  const where = { ...PUBLIC_WHERE };
  if (STATUS_GROUPS[group]) where.status = { in: STATUS_GROUPS[group] };
  if (CONTEST_TYPES[type]) where.type = type;
  if (wiki) where.primaryWiki = wiki;
  if (q) where.OR = [{ title: { contains: q } }, { organizingCommunity: { contains: q } }];

  const [items, total, wikis] = await Promise.all([
    prisma.contest.findMany({
      where,
      orderBy: SORTS[sort] || SORTS.newest,
      select: CARD_SELECT,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contest.count({ where }),
    prisma.contest.findMany({ where: PUBLIC_WHERE, distinct: ['primaryWiki'], select: { primaryWiki: true }, orderBy: { primaryWiki: 'asc' } }),
  ]);
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), wikis: wikis.map((w) => w.primaryWiki) };
}

// A user's events with all their roles in each, newest first.
async function listForUser(userId, { publicOnly = false } = {}) {
  const memberships = await prisma.contestMembership.findMany({
    where: { userId, status: 'active', contest: publicOnly ? PUBLIC_WHERE : { deletedAt: null } },
    include: { contest: { select: CARD_SELECT } },
    orderBy: { contest: { startDate: 'desc' } },
  });
  const byContest = new Map();
  for (const m of memberships) {
    if (!byContest.has(m.contestId)) byContest.set(m.contestId, { contest: m.contest, roles: [] });
    byContest.get(m.contestId).roles.push(m.role);
  }
  return [...byContest.values()];
}

function members(contestId) {
  return prisma.contestMembership.findMany({
    where: { contestId, status: 'active' },
    include: { user: { select: { id: true, username: true, homeWiki: true } } },
    orderBy: [{ role: 'asc' }, { user: { username: 'asc' } }],
  });
}

function overrides(contestId) {
  return prisma.contestPermission.findMany({
    where: { contestId },
    include: { user: { select: { username: true } } },
    orderBy: [{ userId: 'asc' }, { permission: 'asc' }],
  });
}

function activity(contestId, take = 100) {
  return prisma.auditLog.findMany({
    where: { contestId },
    orderBy: { id: 'desc' },
    take,
    include: { actor: { select: { username: true } } },
  });
}

module.exports = { SORTS, isVisible, listByGroup, listPublic, listForUser, members, overrides, activity };
