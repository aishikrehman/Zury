// Site upkeep for superusers: how big things are, a database backup, and clean-up.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = require('../config/prisma');
const audit = require('./auditService');

// The SQLite file behind DATABASE_URL (Prisma reads relative paths from prisma/).
function dbFile() {
  const raw = (process.env.DATABASE_URL || '').replace(/^file:/, '').split('?')[0];
  return path.isAbsolute(raw) ? raw : path.join(__dirname, '..', '..', 'prisma', raw);
}

const TABLES = [
  ['Users', 'user'], ['Events', 'contest'], ['Series', 'eventSeries'], ['Entries', 'submission'], ['Reviews', 'review'],
  ['Members', 'contestMembership'], ['Tracked edits', 'contribution'], ['Activity log', 'auditLog'], ['Sessions', 'session'], ['Wikis known', 'wikiSite'],
];

async function status() {
  const file = dbFile();
  const counts = await Promise.all(TABLES.map(([, model]) => prisma[model].count()));
  const [expired, oldestLog] = await Promise.all([
    prisma.session.count({ where: { expiresAt: { lt: new Date() } } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const mem = process.memoryUsage();
  return {
    dbBytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
    tables: TABLES.map(([label], i) => ({ label, count: counts[i] })),
    expiredSessions: expired,
    oldestLog: oldestLog?.createdAt || null,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: Math.round(mem.rss / 1048576),
    host: os.hostname(),
    version: require('../../package.json').version,
  };
}

// A consistent copy of the whole database (VACUUM INTO), without anyone's sign-in session.
async function backup(actorId) {
  const copy = path.join(os.tmpdir(), `zury-backup-${Date.now()}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  const client = new PrismaClient({ datasources: { db: { url: `file:${copy}` } } });
  try {
    await client.$executeRawUnsafe('DELETE FROM "Session"');
    await client.$executeRawUnsafe('VACUUM');
  } finally {
    await client.$disconnect();
  }
  await audit.record({ actorId, action: 'site.backup', entityType: 'Site', entityId: 'database', details: { bytes: fs.statSync(copy).size } });
  return copy;
}

async function cleanUp({ actorId, task }) {
  let removed = 0;
  if (task === 'sessions') {
    removed = (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
  } else if (task === 'activity') {
    const yearAgo = new Date(Date.now() - 365 * 86400000);
    removed = (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: yearAgo } } })).count;
  } else {
    throw new Error('Unknown task.');
  }
  await audit.record({ actorId, action: `site.cleanup.${task}`, entityType: 'Site', entityId: task, details: { removed } });
  return removed;
}

module.exports = { status, backup, cleanUp, dbFile };
