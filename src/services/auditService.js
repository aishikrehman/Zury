const prisma = require('../config/prisma');

function record({ actorId = null, contestId = null, action, entityType, entityId = null, details = null }, client = prisma) {
  return client.auditLog.create({
    data: {
      actorId,
      contestId,
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      details: details == null ? null : JSON.stringify(details),
    },
  });
}

async function list({ page = 1, perPage = 50 } = {}) {
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { actor: { select: { username: true } }, contest: { select: { id: true, title: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  return { items, total, page, perPage };
}

module.exports = { record, list };
