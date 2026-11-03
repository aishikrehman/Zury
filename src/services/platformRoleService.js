const prisma = require('../config/prisma');
const audit = require('./auditService');
const { PLATFORM_ROLES } = require('../permissions/registry');

class RoleError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Only roles Zury owns can be granted here; Wikimedia roles come from verification.
function assertAssignable(role) {
  const def = PLATFORM_ROLES[role];
  if (def?.source !== 'zury' || def.cliOnly) throw new RoleError(`"${role}" can't be assigned here.`);
}

async function grant({ actorId, userId, role }) {
  assertAssignable(role);
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new RoleError('User not found.');
    const existing = await tx.userGlobalRole.findUnique({ where: { userId_role: { userId, role } } });
    if (existing) return existing;
    const created = await tx.userGlobalRole.create({ data: { userId, role, assignedById: actorId } });
    await audit.record(
      { actorId, action: 'platformRole.granted', entityType: 'User', entityId: userId, details: { role, username: target.username } },
      tx,
    );
    return created;
  });
}

async function revoke({ actorId, userId, role }) {
  assertAssignable(role);
  if (actorId === userId) throw new RoleError("You can't remove your own platform role. Ask another administrator.");
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    const { count } = await tx.userGlobalRole.deleteMany({ where: { userId, role } });
    if (count) {
      await audit.record(
        { actorId, action: 'platformRole.revoked', entityType: 'User', entityId: userId, details: { role, username: target?.username } },
        tx,
      );
    }
    return count;
  });
}

module.exports = { RoleError, grant, revoke };
