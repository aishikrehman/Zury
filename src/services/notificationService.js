// Zury's own notifications (the bell in the header). Each is a message key with values, so it
// shows in the reader's language. Sending never fails the action that caused it.
const prisma = require('../config/prisma');

const KEEP_DAYS = 90;

// One person or several; client: a transaction, when the cause is part of one.
async function notify(userIds, { kind, message, params = {}, link = '', contestId = null }, client = prisma) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  if (!ids.length) return;
  try {
    await client.notification.createMany({ data: ids.map((userId) => ({ userId, kind, message, params: JSON.stringify(params), link: String(link).slice(0, 1000), contestId })) });
  } catch (err) {
    console.error('notification not saved:', err.message);
  }
}

const unreadCount = (userId) => prisma.notification.count({ where: { userId, readAt: null } });

function latest(userId, take = 8) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { id: 'desc' }, take });
}

async function page(userId, { page: n = 1, perPage = 30 } = {}) {
  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { id: 'desc' }, skip: (n - 1) * perPage, take: perPage }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { items, total, page: n, perPage };
}

// Opening one marks it read and gives where it leads.
async function open(userId, id) {
  const n = await prisma.notification.findFirst({ where: { id, userId } });
  if (!n) return null;
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  return n;
}

const markAllRead = (userId) => prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });

// Old read notifications are dropped (called from the daily maintenance).
const prune = () => prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 864e5) } } });

// The text in the reader's language.
function text(t, n) {
  let params = {};
  try {
    params = JSON.parse(n.params || '{}');
  } catch {
    /* shown without values */
  }
  return t(n.message, params);
}

module.exports = { notify, unreadCount, latest, page, open, markAllRead, prune, text };
