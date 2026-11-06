// Roles on a series or an edition (stage 3). A role covers its own level only:
// - a series role lets someone run the series (its details, new editions);
// - an edition role lets someone run that edition (its page, its drafts, adding events);
// - with appliesToChildren it also reaches down: a series role to every edition and event of
//   the series, an edition role to every event of the edition (see permissionService.inheritedRoles).
// Nothing reaches up: running an event gives nothing on its edition or series, and siblings
// (other editions, other events, other local events) never share roles.
const prisma = require('../config/prisma');
const audit = require('./auditService');

const ROLES = ['organizer', 'jury', 'viewer'];

class ScopeRoleError extends Error {}

const platformRuns = (req) => !!req.user && req.permissions.has('manageAnyEvent');

async function canRunSeries(req, seriesId) {
  if (!req.user) return false;
  if (platformRuns(req)) return true;
  return !!(await prisma.scopeRole.findFirst({ where: { userId: req.user.id, role: 'organizer', seriesId } }));
}

// An edition: its own organizers, or the series' organizers whose role applies to children.
async function canRunEdition(req, edition) {
  if (!req.user) return false;
  if (platformRuns(req)) return true;
  return !!(await prisma.scopeRole.findFirst({
    where: { userId: req.user.id, role: 'organizer', OR: [{ editionId: edition.id }, { seriesId: edition.seriesId, appliesToChildren: true }] },
  }));
}

// Who may see drafts at a level (any role there, including jury and viewers).
async function canSeeEdition(req, edition) {
  if (!req.user) return false;
  if (platformRuns(req)) return true;
  return !!(await prisma.scopeRole.findFirst({
    where: { userId: req.user.id, OR: [{ editionId: edition.id }, { seriesId: edition.seriesId, appliesToChildren: true }] },
  }));
}

// May this person put an event under the form's "Part of" (parsed.series)? A new series or
// edition is theirs to make; an existing one needs its organizer. Unchanged placement passes.
async function mayPlace(req, target, current = {}) {
  if (!target) return true;
  const sr = await prisma.eventSeries.findUnique({ where: { slug: target.slug } });
  if (!sr) return true;
  if (!target.edition) return current.seriesId === sr.id || canRunSeries(req, sr.id);
  const edition = await prisma.edition.findUnique({ where: { seriesId_slug: { seriesId: sr.id, slug: target.edition } } });
  if (!edition) return canRunSeries(req, sr.id);
  return current.editionId === edition.id || canRunEdition(req, edition);
}

// Series and editions this person may put events in, for a "Move to" or "Copy to" list.
async function placesFor(req) {
  if (!req.user) return [];
  const all = platformRuns(req);
  const roles = all ? [] : await prisma.scopeRole.findMany({ where: { userId: req.user.id, role: 'organizer' } });
  const series = await prisma.eventSeries.findMany({
    where: { deletedAt: null, status: { not: 'archived' } },
    include: { editionRecords: { where: { deletedAt: null, status: { not: 'archived' } }, orderBy: { slug: 'desc' } } },
    orderBy: { title: 'asc' },
  });
  const out = [];
  for (const s of series) {
    const sr = roles.find((r) => r.seriesId === s.id);
    if (all || sr) out.push({ value: `s:${s.id}`, label: `${s.title} (/${s.slug})`, seriesId: s.id });
    for (const e of s.editionRecords) {
      if (all || sr?.appliesToChildren || roles.some((r) => r.editionId === e.id)) out.push({ value: `e:${e.id}`, label: `${e.title} (/${s.slug}/${e.slug})`, editionId: e.id });
    }
  }
  return out;
}

function list({ seriesId, editionIds = [] }) {
  return prisma.scopeRole.findMany({
    where: { OR: [{ seriesId }, ...(editionIds.length ? [{ editionId: { in: editionIds } }] : [])] },
    include: { user: { select: { id: true, username: true } }, edition: { select: { slug: true } } },
    orderBy: [{ seriesId: 'desc' }, { editionId: 'asc' }, { role: 'asc' }],
  });
}

// level: { seriesId } or { editionId } — exactly one.
async function grant({ actorId, username, role, level, appliesToChildren }) {
  if (!ROLES.includes(role)) throw new ScopeRoleError('Choose a role.');
  if (!!level.seriesId === !!level.editionId) throw new ScopeRoleError('Choose the series or one of its editions.');
  const user = await prisma.user.findFirst({ where: { username: String(username || '').trim() } });
  if (!user) throw new ScopeRoleError('No Zury user has that name. They need to log in to Zury once first.');
  const where = { userId: user.id, role, seriesId: level.seriesId || null, editionId: level.editionId || null };
  const existing = await prisma.scopeRole.findFirst({ where });
  const row = existing
    ? await prisma.scopeRole.update({ where: { id: existing.id }, data: { appliesToChildren: !!appliesToChildren } })
    : await prisma.scopeRole.create({ data: { ...where, appliesToChildren: !!appliesToChildren, assignedById: actorId } });
  await audit.record({ actorId, action: 'scopeRole.grant', entityType: level.seriesId ? 'EventSeries' : 'Edition', entityId: level.seriesId || level.editionId, details: { user: user.username, role, appliesToChildren: !!appliesToChildren } });
  return row;
}

async function revoke({ actorId, id, seriesId, editionIds }) {
  const row = await prisma.scopeRole.findFirst({ where: { id, OR: [{ seriesId }, { editionId: { in: editionIds } }] }, include: { user: true } });
  if (!row) throw new ScopeRoleError('That role is not on this series.');
  await prisma.scopeRole.delete({ where: { id: row.id } });
  await audit.record({ actorId, action: 'scopeRole.revoke', entityType: row.seriesId ? 'EventSeries' : 'Edition', entityId: row.seriesId || row.editionId, details: { user: row.user.username, role: row.role } });
}

module.exports = { ROLES, ScopeRoleError, canRunSeries, canRunEdition, canSeeEdition, mayPlace, placesFor, list, grant, revoke };
