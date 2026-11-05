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
    const fresh = now - new Date(right.verifiedAt) <= RIGHTS_MAX_AGE_MS;
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

const uniq = (xs) => [...new Set(xs)];

/**
 * Pure: an event's permissions for one person.
 *
 * - `global`: platform authority (stewards, global sysops, superusers) plus
 *   event-wide roles (memberships with no wiki). Holding manageEvent here makes
 *   someone a global controller of the event.
 * - `forWiki(w)`: global, plus local-admin rights on w and roles scoped to w.
 * - `permissions`: the set for the current context — the given wiki, or for a
 *   single-wiki event its only wiki, otherwise the global set.
 *
 * Overrides only adjust event-derived permissions; they never take away platform authority.
 */
function computeContestScope(subject, contest, memberships = [], overrides = [], { wikis, wiki } = {}) {
  const eventWikis = wikis && wikis.length ? wikis : [contest.primaryWiki];
  const active = memberships.filter((m) => m.status === 'active' && EVENT_ROLES[m.role]);
  // Participants take part in the whole event; their wiki only says who looks after them.
  const eventWide = (m) => !m.wiki || m.role === 'participant';
  const globalRoles = uniq(active.filter(eventWide).map((m) => m.role));
  const wikiRoles = {};
  for (const m of active.filter((x) => !eventWide(x))) (wikiRoles[m.wiki] ||= new Set()).add(m.role);

  const rolePermissions = (roles) => {
    const keys = roles.flatMap((role) => EVENT_ROLES[role].permissions);
    keys.push(...overrides.filter((o) => o.allowed).map((o) => o.permission));
    const set = expand(keys);
    for (const o of overrides) if (!o.allowed) set.delete(o.permission);
    return set;
  };

  const global = new Set([...platformPermissions(subject, null), ...(globalRoles.length || overrides.length ? rolePermissions(globalRoles) : [])]);
  const cache = new Map();
  const forWiki = (w) => {
    if (!cache.has(w)) {
      const local = [...(wikiRoles[w] || [])];
      cache.set(w, new Set([...global, ...platformPermissions(subject, w), ...(local.length ? rolePermissions(local) : [])]));
    }
    return cache.get(w);
  };

  const current = wiki || (eventWikis.length === 1 ? eventWikis[0] : null);
  return {
    permissions: current ? forWiki(current) : global,
    global,
    forWiki,
    wiki: current,
    eventRoles: uniq([...globalRoles, ...(current ? [...(wikiRoles[current] || [])] : [])]),
    globalRoles,
    wikiRoles: Object.fromEntries(Object.entries(wikiRoles).map(([w, r]) => [w, [...r]])),
    hasAnyRole: active.length > 0,
    platformRoles: [...subject.platformRoles],
    isLocalAdminHere: current ? subject.adminWikis.has(current) : false,
    isGlobalController: global.has('manageEvent'),
    // Wikis of this event where the person holds a permission.
    wikisWith: (permission) => eventWikis.filter((w) => forWiki(w).has(permission)),
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

// Roles from the event's edition or series that were given with "applies to children".
// They count event-wide, as if held on the event; roles without that flag stay on their level.
async function inheritedRoles(userId, contest) {
  let seriesId = contest.seriesId || null;
  if (contest.editionId) {
    const ed = await prisma.edition.findUnique({ where: { id: contest.editionId }, select: { seriesId: true } });
    seriesId = ed?.seriesId || null;
  }
  const levels = [];
  if (contest.editionId) levels.push({ editionId: contest.editionId });
  if (seriesId) levels.push({ seriesId });
  if (!levels.length) return [];
  const rows = await prisma.scopeRole.findMany({ where: { userId, appliesToChildren: true, OR: levels } });
  return rows.map((r) => ({ role: r.role, wiki: '', status: 'active', inheritedFrom: r.editionId ? 'edition' : 'series' }));
}

// opts: { wikis: event's active wiki database names, wiki: current wiki context }
async function contestScope(subject, contest, opts = {}) {
  if (!subject.user) return computeContestScope(subject, contest, [], [], opts);
  const where = { contestId: contest.id, userId: subject.user.id };
  const [memberships, overrides, inherited] = await Promise.all([
    prisma.contestMembership.findMany({ where }),
    prisma.contestPermission.findMany({ where }),
    inheritedRoles(subject.user.id, contest),
  ]);
  return computeContestScope(subject, contest, [...memberships, ...inherited], overrides, opts);
}

module.exports = {
  inheritedRoles,
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
