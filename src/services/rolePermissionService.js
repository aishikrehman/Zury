// What each role may do: the built-in permissions (src/permissions/registry.js) plus the
// changes superusers make on the Permissions page, kept in RolePermissionChange.
// The roles' permission lists are updated in place, so every check sees the change at once.
const prisma = require('../config/prisma');
const audit = require('./auditService');
const { PLATFORM_ROLES, EVENT_ROLES, PERMISSIONS } = require('../permissions/registry');

const TABLES = { platform: PLATFORM_ROLES, event: EVENT_ROLES };
// The built-in lists, before any change.
const DEFAULTS = Object.fromEntries(
  Object.entries(TABLES).map(([kind, roles]) => [kind, Object.fromEntries(Object.entries(roles).map(([key, r]) => [key, [...r.permissions]]))]),
);
// Superusers keep everything, so nobody can lock the site's owners out.
const LOCKED = (kind, role) => kind === 'platform' && role === 'superuser';

class RolePermissionError extends Error {}

function applyAll(changes) {
  for (const [kind, roles] of Object.entries(TABLES)) {
    for (const [key, role] of Object.entries(roles)) {
      const set = new Set(DEFAULTS[kind][key]);
      for (const c of changes) if (c.kind === kind && c.role === key && !LOCKED(kind, key)) (c.allowed ? set.add(c.permission) : set.delete(c.permission));
      role.permissions.splice(0, role.permissions.length, ...set);
    }
  }
}

let loaded = [];
async function load() {
  loaded = await prisma.rolePermissionChange.findMany();
  applyAll(loaded);
  return loaded;
}

const changes = () => loaded;
const isDefault = (kind, role, permission) => DEFAULTS[kind][role]?.includes(permission);

async function set({ actor, kind, role, permission, allowed }) {
  if (!TABLES[kind]?.[role] || !PERMISSIONS[permission]) throw new RolePermissionError('Unknown role or permission.');
  if (LOCKED(kind, role)) throw new RolePermissionError('Superusers always have every permission.');
  const where = { kind_role_permission: { kind, role, permission } };
  // Back to the built-in setting: no change row needed.
  if (allowed === isDefault(kind, role, permission)) await prisma.rolePermissionChange.deleteMany({ where: { kind, role, permission } });
  else await prisma.rolePermissionChange.upsert({ where, update: { allowed, changedById: actor.id, changedAt: new Date() }, create: { kind, role, permission, allowed, changedById: actor.id } });
  await audit.record({ actorId: actor.id, action: allowed ? 'rolePermission.granted' : 'rolePermission.revoked', entityType: 'Role', entityId: `${kind}:${role}`, details: { permission } });
  await load();
}

async function resetAll(actor) {
  const { count } = await prisma.rolePermissionChange.deleteMany({});
  await audit.record({ actorId: actor.id, action: 'rolePermission.reset', entityType: 'Role', entityId: 'all', details: { count } });
  await load();
  return count;
}

module.exports = { load, set, resetAll, changes, isDefault, LOCKED, RolePermissionError };
