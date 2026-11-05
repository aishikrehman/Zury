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

// Each table read with plain SQL, as it is in the database right now: the backup before a
// migration must work while the code already expects the columns the migration adds.
async function exportAll(client = prisma) {
  const data = {};
  for (const model of ORDER) {
    try {
      data[model] = await client.$queryRawUnsafe('SELECT * FROM `' + model + '`');
    } catch {
      data[model] = []; // a table a migration has not created yet
    }
  }
  return { zury: require('../../package.json').version, createdAt: new Date().toISOString(), data };
}

// Writes one backup file and keeps only the newest ones. Returns its path.
async function write(reason = 'daily') {
  fs.mkdirSync(DIR, { recursive: true });
  const dump = await exportAll();
  const file = path.join(DIR, `zury-${dump.createdAt.replace(/[:.]/g, '-')}-${reason}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(dump, (k, v) => (typeof v === 'bigint' ? Number(v) : v))));
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
    // To this version's columns: unknown ones dropped, missing ones left to their defaults,
    // and values typed as the schema says (MariaDB gives booleans as 0 and 1).
    const fields = models[model].fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');
    const rows = (dump.data[model] || []).map((raw) => {
      const row = {};
      for (const f of fields) {
        if (!(f.name in raw)) continue;
        const v = raw[f.name];
        if (v === null) row[f.name] = null;
        else if (f.type === 'DateTime') row[f.name] = new Date(v);
        else if (f.type === 'Boolean') row[f.name] = v === true || v === 1 || v === '1';
        else if (f.type === 'Int' || f.type === 'Float') row[f.name] = Number(v);
        else row[f.name] = typeof v === 'string' ? v : String(v);
      }
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
