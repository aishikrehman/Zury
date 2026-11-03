// Runs before the server starts (npm start): applies pending migrations and,
// for a brand-new database, adds the sample events so a fresh site isn't empty.
// Set START_EMPTY=true before the first start to skip the samples.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('file:')) {
  console.error('DATABASE_URL must point to a SQLite file, e.g. file:./zury.db');
  process.exit(1);
}
// Prisma resolves relative SQLite paths against the schema's folder.
const raw = url.slice('file:'.length).split('?')[0];
const dbFile = path.isAbsolute(raw) ? raw : path.join(__dirname, '..', 'prisma', raw);
const isNew = !fs.existsSync(dbFile);

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

if (isNew && process.env.START_EMPTY !== 'true') {
  process.env.SESSION_SECRET ||= 'prepare-only';
  const prisma = require('../src/config/prisma');
  require('../prisma/seed')
    .seedDemoData(prisma)
    .then((r) => console.log(`New database at ${dbFile} with sample data: ${r.contests} events, ${r.submissions} entries.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
