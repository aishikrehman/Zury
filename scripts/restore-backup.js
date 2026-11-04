// Loads a backup (backups/zury-….json.gz) into the empty database DATABASE_URL points at.
// Refuses to touch a database that already has data. Usage: node scripts/restore-backup.js <file>
require('dotenv').config();
const backups = require('../src/services/backupService');
const prisma = require('../src/config/prisma');

backups.restore(process.argv[2])
  .then((counts) => console.log('Restored:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')))
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
