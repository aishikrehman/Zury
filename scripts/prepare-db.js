// Runs before the server starts (npm start). Takes a backup when the database already
// has data, then applies new migrations (only "migrate deploy": reviewed, additive
// steps; never a reset).
require('dotenv').config();
require('../src/config/database');
const { execSync } = require('child_process');

async function main() {
  const prisma = require('../src/config/prisma');
  let hasData = false;
  try {
    hasData = (await prisma.user.count()) > 0;
  } catch {
    hasData = false; // no tables yet
  }
  if (hasData) {
    const file = await require('../src/services/backupService').write('before-start');
    console.log(`Backup before start: ${file}`);
  }
  await prisma.$disconnect();
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
