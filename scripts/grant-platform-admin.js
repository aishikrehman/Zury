// Bootstraps the first platform administrator. The user must have logged in once.
// Usage: npm run admin:grant -- "Username"
const prisma = require('../src/config/prisma');
const audit = require('../src/services/auditService');

async function main() {
  const username = process.argv.slice(2).join(' ').trim();
  if (!username) {
    console.error('Usage: npm run admin:grant -- "Username"');
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No Zury user named "${username}". They need to log in once first.`);
    process.exitCode = 1;
    return;
  }
  const existing = await prisma.userGlobalRole.findUnique({ where: { userId_role: { userId: user.id, role: 'platform-admin' } } });
  if (existing) {
    console.log(`${username} is already a platform administrator.`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.userGlobalRole.create({ data: { userId: user.id, role: 'platform-admin' } });
    await audit.record(
      { action: 'platformRole.granted', entityType: 'User', entityId: user.id, details: { role: 'platform-admin', username, via: 'cli' } },
      tx,
    );
  });
  console.log(`${username} is now a platform administrator.`);
}

main().finally(() => prisma.$disconnect());
