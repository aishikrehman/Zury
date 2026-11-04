// Site upkeep for superusers: how big things are, a database backup, and clean-up.
const os = require('os');
const prisma = require('../config/prisma');
const audit = require('./auditService');
const backups = require('./backupService');

// The database's size on the server, from MariaDB's own table statistics.
async function databaseBytes() {
  const [row] = await prisma.$queryRawUnsafe('SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()');
  return Number(row.bytes);
}

const TABLES = [
  ['Users', 'user'], ['Events', 'contest'], ['Series', 'eventSeries'], ['Entries', 'submission'], ['Reviews', 'review'],
  ['Members', 'contestMembership'], ['Tracked edits', 'contribution'], ['Activity log', 'auditLog'], ['Sessions', 'session'], ['Wikis known', 'wikiSite'],
];

async function status() {
  const counts = await Promise.all(TABLES.map(([, model]) => prisma[model].count()));
  const [expired, oldestLog] = await Promise.all([
    prisma.session.count({ where: { expiresAt: { lt: new Date() } } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const mem = process.memoryUsage();
  return {
    dbBytes: await databaseBytes(),
    backups: backups.list().slice(0, 5),
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

// A fresh backup (every table but sign-in sessions), also kept with the daily ones.
async function backup(actorId) {
  const file = await backups.write('manual');
  await audit.record({ actorId, action: 'site.backup', entityType: 'Site', entityId: 'database', details: { file: require('path').basename(file) } });
  return file;
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

module.exports = { status, backup, cleanUp };
