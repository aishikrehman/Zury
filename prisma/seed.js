// Demo data for development. Safe to re-run: it replaces earlier demo data and
// never touches real users or events. Run with `npm run seed`.

const DEMO_USERS = [
  { key: 'steward', username: 'Steward (demo)', homeWiki: 'metawiki', registered: '2009-02-14', rights: [['*', 'steward']] },
  { key: 'gsysop', username: 'Global Sysop (demo)', homeWiki: 'enwiki', registered: '2011-06-01', rights: [['*', 'global-sysop']] },
  { key: 'bnadmin', username: 'Bn Admin (demo)', homeWiki: 'bnwiki', registered: '2012-03-21', rights: [['bnwiki', 'sysop']] },
  { key: 'padmin', username: 'Platform Admin (demo)', homeWiki: 'enwiki', registered: '2015-09-09', platformRoles: ['platform-admin'] },
  { key: 'organizer', username: 'Organizer (demo)', homeWiki: 'bnwiki', registered: '2016-01-10' },
  { key: 'juror', username: 'Juror (demo)', homeWiki: 'commonswiki', registered: '2014-07-30' },
  { key: 'participant', username: 'Participant (demo)', homeWiki: 'bnwiki', registered: '2019-11-02' },
  { key: 'newcomer', username: 'Newcomer (demo)', homeWiki: 'bnwiki', registered: '2026-08-15' },
];

const d = (s) => new Date(`${s}T00:00:00Z`);

const DEMO_CONTESTS = [
  {
    slug: 'demo-wlm-bangladesh-2026',
    title: 'Wiki Loves Monuments 2026 in Bangladesh',
    description: 'Photograph the built heritage of Bangladesh and upload it to Wikimedia Commons.',
    type: 'photo', status: 'active', primaryWiki: 'commonswiki', language: 'bn', timezone: 'Asia/Dhaka',
    startDate: '2026-09-01', endDate: '2026-11-30', createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['juror', 'jury'], ['bnadmin', 'jury'], ['participant', 'participant'], ['newcomer', 'participant']],
    overrides: [['juror', 'exportData', true]],
  },
  {
    slug: 'demo-liberation-war-editathon',
    title: 'Liberation War Archives Edit-a-thon',
    description: 'Improve Bangla Wikipedia coverage of the 1971 Liberation War using archival sources.',
    type: 'editathon', status: 'active', primaryWiki: 'bnwiki', language: 'bn', timezone: 'Asia/Dhaka',
    startDate: '2026-10-15', endDate: '2026-12-16', createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['participant', 'participant'], ['juror', 'participant'], ['newcomer', 'participant']],
    overrides: [['organizer', 'sendMassMessage', false]],
  },
  {
    slug: 'demo-bnwiki-womens-history-2027',
    title: "Bangla Wikipedia Women's History Month 2027",
    description: 'Write and expand biographies of women on Bangla Wikipedia.',
    type: 'writing', status: 'upcoming', primaryWiki: 'bnwiki', language: 'bn', timezone: 'Asia/Dhaka',
    startDate: '2027-03-01', endDate: '2027-03-31', createdBy: 'bnadmin',
    members: [['organizer', 'organizer'], ['bnadmin', 'organizer'], ['juror', 'jury']],
  },
  {
    slug: 'demo-wiki-loves-food-2027',
    title: 'Wiki Loves Food Bangladesh 2027',
    description: 'Document the cuisine of Bangladesh on Wikimedia Commons.',
    type: 'photo', status: 'upcoming', primaryWiki: 'commonswiki', language: 'bn', timezone: 'Asia/Dhaka',
    startDate: '2027-01-15', endDate: '2027-02-28', createdBy: 'bnadmin',
    members: [['bnadmin', 'organizer']],
  },
  {
    slug: 'demo-wikidata-heritage-sprint',
    title: 'Wikidata Bangladesh Heritage Sprint',
    description: 'Add coordinates, heritage designations and images to Wikidata items for protected sites.',
    type: 'data', status: 'completed', primaryWiki: 'wikidatawiki', language: 'en', timezone: 'UTC',
    startDate: '2026-05-01', endDate: '2026-05-31', createdBy: 'juror',
    members: [['juror', 'organizer'], ['participant', 'participant'], ['organizer', 'participant']],
  },
  {
    slug: 'demo-wle-bangladesh-2026',
    title: 'Wiki Loves Earth 2026 in Bangladesh',
    description: 'Photograph protected natural areas of Bangladesh.',
    type: 'photo', status: 'completed', primaryWiki: 'commonswiki', language: 'bn', timezone: 'Asia/Dhaka',
    startDate: '2026-05-01', endDate: '2026-07-31', createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['juror', 'jury'], ['participant', 'participant']],
  },
  {
    slug: 'demo-enwiki-jury-calibration',
    title: 'Jury Calibration Round',
    description: 'A private dry run for training new jurors. Only members and platform-wide authorities can see it.',
    type: 'writing', status: 'draft', visibility: 'private', primaryWiki: 'enwiki', language: 'en', timezone: 'UTC',
    startDate: '2027-01-10', endDate: '2027-01-20', createdBy: 'juror',
    members: [['juror', 'organizer'], ['participant', 'viewer']],
  },
];

async function clearDemoData(prisma) {
  const [users, contests] = await Promise.all([
    prisma.user.findMany({ where: { isDemo: true }, select: { id: true } }),
    prisma.contest.findMany({ where: { isDemo: true }, select: { id: true } }),
  ]);
  const userIds = users.map((u) => u.id);
  const contestIds = contests.map((c) => c.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { contestId: { in: contestIds } }] } });
  await prisma.contest.deleteMany({ where: { isDemo: true } });
  await prisma.user.deleteMany({ where: { isDemo: true } });
}

async function seedDemoData(prisma) {
  await clearDemoData(prisma);

  const users = {};
  for (const [i, u] of DEMO_USERS.entries()) {
    const created = await prisma.user.create({
      data: {
        wikimediaId: -(i + 1),
        username: u.username,
        homeWiki: u.homeWiki,
        wikimediaRegisteredAt: d(u.registered),
        isDemo: true,
        wikiRoles: {
          create: (u.rights || []).map(([wiki, rightName]) => ({ wiki, rightName, verificationSource: 'demo' })),
        },
        globalRoles: { create: (u.platformRoles || []).map((role) => ({ role })) },
      },
    });
    users[u.key] = created;
    for (const role of u.platformRoles || []) {
      await prisma.auditLog.create({
        data: { action: 'platformRole.granted', entityType: 'User', entityId: String(created.id), details: JSON.stringify({ role, username: u.username, via: 'seed' }) },
      });
    }
  }

  for (const c of DEMO_CONTESTS) {
    const creator = users[c.createdBy];
    const contest = await prisma.contest.create({
      data: {
        slug: c.slug,
        title: c.title,
        description: c.description,
        type: c.type,
        status: c.status,
        visibility: c.visibility || 'public',
        primaryWiki: c.primaryWiki,
        language: c.language,
        timezone: c.timezone,
        startDate: d(c.startDate),
        endDate: d(c.endDate),
        isDemo: true,
        createdById: creator.id,
        memberships: {
          create: c.members.map(([userKey, role]) => ({ userId: users[userKey].id, role, assignedById: creator.id })),
        },
        permissionOverrides: {
          create: (c.overrides || []).map(([userKey, permission, allowed]) => ({ userId: users[userKey].id, permission, allowed })),
        },
      },
    });
    await prisma.auditLog.create({
      data: { actorId: creator.id, contestId: contest.id, action: 'contest.created', entityType: 'Contest', entityId: String(contest.id), details: JSON.stringify({ title: c.title }) },
    });
    for (const [userKey, permission, allowed] of c.overrides || []) {
      await prisma.auditLog.create({
        data: {
          actorId: creator.id,
          contestId: contest.id,
          action: 'contestPermission.set',
          entityType: 'User',
          entityId: String(users[userKey].id),
          details: JSON.stringify({ username: users[userKey].username, permission, allowed }),
        },
      });
    }
  }

  return { users: DEMO_USERS.length, contests: DEMO_CONTESTS.length };
}

module.exports = { seedDemoData, clearDemoData, DEMO_USERS, DEMO_CONTESTS };

if (require.main === module) {
  require('dotenv').config();
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  seedDemoData(prisma)
    .then(({ users, contests }) => console.log(`Seeded ${users} demo users and ${contests} demo events.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
