// Builds prisma/demo.db: every migration applied plus the sample events, people
// and entries. A new installation starts from a copy of it (see prepare-db.js).
//   npm run demo:build              sample data only
//   npm run demo:build -- --catalog also store the wiki and language lists from Wikimedia
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const target = path.join(__dirname, '..', 'prisma', 'demo.db');
const tmp = `${target}.building`;
for (const f of [tmp, `${tmp}-journal`]) fs.rmSync(f, { force: true });

process.env.DATABASE_URL = `file:${tmp.replace(/\\/g, '/')}`;
process.env.SESSION_SECRET ||= 'build-only';
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });

(async () => {
  const prisma = require('../src/config/prisma');
  try {
    if (process.argv.includes('--catalog')) {
      const r = await require('../src/wiki/catalogService').syncSitematrix();
      console.log(`Stored ${r.wikis} wikis and ${r.languages} languages.`);
    }
    const r = await require('../prisma/seed').seedDemoData(prisma);
    console.log(`Seeded ${r.users} users, ${r.contests} events and ${r.submissions} submissions.`);
    await prisma.session.deleteMany();
    await prisma.$executeRawUnsafe('VACUUM');
  } finally {
    await prisma.$disconnect();
  }
  fs.renameSync(tmp, target);
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${Math.round(fs.statSync(target).size / 1024)} KB).`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
