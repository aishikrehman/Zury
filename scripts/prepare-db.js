// Runs before the server starts (npm start):
// 1. If the database file doesn't exist yet, start from a copy of prisma/demo.db
//    (sample events, so a fresh site isn't empty). Set START_EMPTY=true to skip.
// 2. Apply any pending migrations.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prismaDir = path.join(__dirname, '..', 'prisma');
const demo = path.join(prismaDir, 'demo.db');
const url = process.env.DATABASE_URL || '';

if (!url.startsWith('file:')) {
  console.error('DATABASE_URL must point to a SQLite file, e.g. file:./zury.db');
  process.exit(1);
}
// Prisma resolves relative SQLite paths against the schema's folder.
const raw = url.slice('file:'.length).split('?')[0];
const dbFile = path.isAbsolute(raw) ? raw : path.join(prismaDir, raw);

if (!fs.existsSync(dbFile)) {
  if (process.env.START_EMPTY !== 'true' && fs.existsSync(demo)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.copyFileSync(demo, dbFile);
    console.log(`New database created from the sample data at ${dbFile}.`);
  } else {
    console.log(`New empty database at ${dbFile}.`);
  }
}
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
