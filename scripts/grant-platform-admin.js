// Grants a Zury platform role from the server command line. The user must have logged in once.
// Usage: npm run admin:grant -- "Username" [--role=platform-admin|superuser]
const prisma = require('../src/config/prisma');
const audit = require('../src/services/auditService');
const { PLATFORM_ROLES } = require('../src/permissions/registry');

async function main() {
  const args = process.argv.slice(2);
  const roleArg = args.find((a) => a.startsWith('--role='));
  const role = roleArg ? roleArg.slice('--role='.length) : 'platform-admin';
  const username = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!username || PLATFORM_ROLES[role]?.source !== 'zury') {
    const roles = Object.entries(PLATFORM_ROLES).filter(([, r]) => r.source === 'zury').map(([k]) => k);
    console.error(`Usage: npm run admin:grant -- "Username" [--role=${roles.join('|')}]`);
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No Zury user named "${username}". They need to log in once first.`);
    process.exitCode = 1;
    return;
  }
  const existing = await prisma.userGlobalRole.findUnique({ where: { userId_role: { userId: user.id, role } } });
  if (existing) {
    console.log(`${username} already has ${PLATFORM_ROLES[role].label}.`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.userGlobalRole.create({ data: { userId: user.id, role } });
    await audit.record({ action: 'platformRole.granted', entityType: 'User', entityId: user.id, details: { role, username, via: 'cli' } }, tx);
  });
  console.log(`${username} now has ${PLATFORM_ROLES[role].label}.`);
}

main().finally(() => prisma.$disconnect());
