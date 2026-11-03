const prisma = require('../config/prisma');
const {
  IMPLIES,
  PLATFORM_ROLES,
  EVENT_ROLES,
  GLOBAL_GROUP_ROLES,
  LOCAL_GROUP_ROLES,
} = require('../permissions/registry');

// Verified rights older than this are ignored, so a desysop on-wiki stops
// counting here even if refreshes keep failing.
const RIGHTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const EMPTY_SUBJECT = Object.freeze({ user: null, platformRoles: new Set(), adminWikis: new Set() });

function expand(keys) {
  const result = new Set();
  const queue = [...keys];
  while (queue.length) {
    const key = queue.pop();
    if (result.has(key)) continue;
    result.add(key);
    queue.push(...(IMPLIES[key] || []));
  }
  return result;
}

// `user` must include globalRoles and wikiRoles.
function buildSubject(user, now = new Date()) {
  if (!user) return EMPTY_SUBJECT;
  const platformRoles = new Set();
  const adminWikis = new Set();

  for (const { role } of user.globalRoles || []) {
    if (PLATFORM_ROLES[role]?.source === 'zury') platformRoles.add(role);
  }
  for (const right of user.wikiRoles || []) {
    const fresh = right.verificationSource === 'demo' || now - new Date(right.verifiedAt) <= RIGHTS_MAX_AGE_MS;
    if (!fresh) continue;
    if (right.wiki === '*' && GLOBAL_GROUP_ROLES[right.rightName]) {
      platformRoles.add(GLOBAL_GROUP_ROLES[right.rightName]);
    } else if (right.wiki !== '*' && LOCAL_GROUP_ROLES[right.rightName] === 'local-admin') {
      adminWikis.add(right.wiki);
    }
  }
  if (adminWikis.size) platformRoles.add('local-admin');
  return { user, platformRoles, adminWikis };
}

function platformPermissions(subject, wiki) {
  const keys = [];
  for (const role of subject.platformRoles) {
    const def = PLATFORM_ROLES[role];
    if (def.scope === 'wiki') {
      keys.push(...(def.globalPermissions || []));
      if (wiki && subject.adminWikis.has(wiki)) keys.push(...def.permissions);
    } else {
      keys.push(...def.permissions);
    }
  }
  return expand(keys);
}

function globalPermissions(subject) {
  return platformPermissions(subject, null);
}

// Which wikis this person may use as an event's primary wiki: any wiki if they
// can create events through a non-wiki-scoped role, otherwise only wikis where
// they are a local admin.
function canUseWikiForEvents(subject, wiki) {
  for (const role of subject.platformRoles) {
    const def = PLATFORM_ROLES[role];
    if (def.scope !== 'wiki' && def.permissions.includes('createEvent')) return true;
  }
  return subject.adminWikis.has(wiki);
}

// null means "any wiki"; otherwise the list of wikis this person may use.
function eventWikiScope(subject) {
  for (const role of subject.platformRoles) {
    const def = PLATFORM_ROLES[role];
    if (def.scope !== 'wiki' && def.permissions.includes('createEvent')) return null;
  }
  return [...subject.adminWikis].sort();
}

// Pure: combines platform authority with event roles and overrides for one event.
// Overrides only adjust event-derived permissions; they can't take away platform authority.
function computeContestScope(subject, contest, memberships = [], overrides = []) {
  const eventRoles = [...new Set(memberships.filter((m) => m.status === 'active').map((m) => m.role))]
    .filter((role) => EVENT_ROLES[role]);

  const eventKeys = eventRoles.flatMap((role) => EVENT_ROLES[role].permissions);
  eventKeys.push(...overrides.filter((o) => o.allowed).map((o) => o.permission));
  const eventPermissions = expand(eventKeys);
  for (const o of overrides) if (!o.allowed) eventPermissions.delete(o.permission);

  const fromPlatform = platformPermissions(subject, contest.primaryWiki);
  return {
    permissions: new Set([...fromPlatform, ...eventPermissions]),
    eventRoles,
    platformRoles: [...subject.platformRoles],
    isLocalAdminHere: subject.adminWikis.has(contest.primaryWiki),
    overrides,
  };
}

async function loadSubject(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { globalRoles: true, wikiRoles: true },
  });
  return user ? buildSubject(user) : null;
}

async function contestScope(subject, contest) {
  if (!subject.user) return computeContestScope(subject, contest);
  const where = { contestId: contest.id, userId: subject.user.id };
  const [memberships, overrides] = await Promise.all([
    prisma.contestMembership.findMany({ where }),
    prisma.contestPermission.findMany({ where }),
  ]);
  return computeContestScope(subject, contest, memberships, overrides);
}

module.exports = {
  EMPTY_SUBJECT,
  RIGHTS_MAX_AGE_MS,
  expand,
  buildSubject,
  globalPermissions,
  canUseWikiForEvents,
  eventWikiScope,
  computeContestScope,
  loadSubject,
  contestScope,
};
