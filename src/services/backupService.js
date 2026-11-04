// Backups that don't depend on the database server: every table (except sign-in
// sessions) as compressed JSON, ids included. Made daily and before each start that
// changes the database, kept for two weeks, and restorable into an empty database.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');

const DIR = process.env.ZURY_BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
const KEEP = 14;

// Parents before children, so a restore finds every row a foreign key points at.
const ORDER = [
  'User', 'EventSeries', 'WikiSite', 'Language', 'WikiNamespace', 'Contest', 'ContestSettings', 'ContestWiki',
  'ContestMembership', 'ContestPermission', 'UserGlobalRole', 'UserWikiRole', 'EventBlock', 'EventSession',
  'SessionAttendance', 'Submission', 'SubmissionHistory', 'Review', 'Appeal', 'ReviewAssignment', 'Contribution',
  'AuditLog', 'RolePermissionChange',
];
const delegate = (client, model) => client[model.charAt(0).toLowerCase() + model.slice(1)];

async function exportAll(client = prisma) {
  const data = {};
  for (const model of ORDER) data[model] = await delegate(client, model).findMany();
  return { zury: require('../../package.json').version, createdAt: new Date().toISOString(), data };
}

// Writes one backup file and keeps only the newest ones. Returns its path.
async function write(reason = 'daily') {
  fs.mkdirSync(DIR, { recursive: true });
  const dump = await exportAll();
  const file = path.join(DIR, `zury-${dump.createdAt.replace(/[:.]/g, '-')}-${reason}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(dump)));
  const old = fs.readdirSync(DIR).filter((f) => /^zury-.*\.json\.gz$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(DIR, f), { force: true });
  return file;
}

// Loads a backup into an empty database (refuses otherwise, so nothing is overwritten).
async function restore(file, client = prisma) {
  if ((await client.user.count()) || (await client.contest.count())) throw new Error('The database is not empty; restore only into an empty one.');
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const models = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  const counts = {};
  for (const model of ORDER) {
    const rows = (dump.data[model] || []).map((row) => {
      for (const f of models[model].fields) if (f.type === 'DateTime' && row[f.name]) row[f.name] = new Date(row[f.name]);
      return row;
    });
    for (let i = 0; i < rows.length; i += 500) await delegate(client, model).createMany({ data: rows.slice(i, i + 500) });
    counts[model] = rows.length;
  }
  return counts;
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => /^zury-.*\.json\.gz$/.test(f)).sort().reverse().map((f) => ({ name: f, bytes: fs.statSync(path.join(DIR, f)).size }));
}

module.exports = { exportAll, write, restore, list, DIR, ORDER };
