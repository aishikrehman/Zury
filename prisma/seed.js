// Demo data for development. Safe to re-run: it replaces earlier demo data and
// never touches real users or events. Run with `npm run seed`.

const { computeAutoStatus } = require('../src/services/lifecycleService');
const { defaultSettings } = require('../src/services/contestFormService');
const { readTypeConfig } = require('../src/events/eventTypes');

const DEMO_USERS = [
  { key: 'steward', username: 'Steward (demo)', homeWiki: 'metawiki', registered: '2009-02-14', edits: 85210, rights: [['*', 'steward']] },
  { key: 'gsysop', username: 'Global Sysop (demo)', homeWiki: 'enwiki', registered: '2011-06-01', edits: 42377, rights: [['*', 'global-sysop']] },
  { key: 'bnadmin', username: 'Bn Admin (demo)', homeWiki: 'bnwiki', registered: '2012-03-21', edits: 18450, rights: [['bnwiki', 'sysop']] },
  { key: 'padmin', username: 'Platform Admin (demo)', homeWiki: 'enwiki', registered: '2015-09-09', edits: 3120, platformRoles: ['platform-admin'] },
  { key: 'organizer', username: 'Organizer (demo)', homeWiki: 'bnwiki', registered: '2016-01-10', edits: 6204, platformRoles: ['event-creator'] },
  { key: 'juror', username: 'Juror (demo)', homeWiki: 'commonswiki', registered: '2014-07-30', edits: 9815 },
  { key: 'participant', username: 'Participant (demo)', homeWiki: 'bnwiki', registered: '2019-11-02', edits: 2417 },
  { key: 'newcomer', username: 'Newcomer (demo)', homeWiki: 'bnwiki', registered: '2026-08-15', edits: 12 },
];

// Dates are midnight in Dhaka unless a time is given.
const d = (s) => new Date(s.length === 10 ? `${s}T00:00:00+06:00` : s);

const DEMO_CONTESTS = [
  {
    slug: 'demo-wlm-bangladesh-2026',
    title: 'Wiki Loves Monuments 2026 in Bangladesh',
    description: 'Photograph the built heritage of Bangladesh and upload it to Wikimedia Commons. Mosques, temples, forts, colonial buildings and archaeological sites all count.',
    type: 'photo',
    primaryWiki: 'commonswiki',
    additionalWikis: ['bnwiki'],
    organizingCommunity: 'Wikimedia Bangladesh',
    contactInfo: 'Commons:Wiki Loves Monuments 2026 in Bangladesh (talk page)',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: {
      registrationOpensAt: '2026-08-20', startDate: '2026-09-01', endDate: '2026-11-30',
      submissionOpensAt: '2026-09-01', submissionDeadline: '2026-11-30T23:59:00+06:00',
      reviewOpensAt: '2026-12-01', reviewDeadline: '2026-12-31', appealDeadline: '2027-01-07', resultsAnnouncedAt: '2027-01-15',
    },
    settings: { appealsEnabled: true, badgesEnabled: true, minAccountAgeDays: 0 },
    typeConfig: { maxEntriesPerParticipant: 0, minResolutionMegapixels: 2, requiredCategory: 'Images from Wiki Loves Monuments 2026 in Bangladesh', awardCategories: ['Best monument', 'Best interior', 'Best series'] },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['juror', 'jury'], ['bnadmin', 'jury'], ['participant', 'participant'], ['newcomer', 'participant']],
    overrides: [['juror', 'exportData', true]],
  },
  {
    slug: 'demo-liberation-war-editathon',
    title: 'Liberation War Archives Edit-a-thon',
    description: 'Improve Bangla Wikipedia coverage of the 1971 Liberation War using archival sources.',
    type: 'editathon',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Bangla Wikipedia community',
    contactInfo: 'উইকিপিডিয়া:এডিটাথন/মুক্তিযুদ্ধ (talk page)',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { registrationOpensAt: '2026-10-01', registrationClosesAt: '2026-12-10', startDate: '2026-10-15', endDate: '2026-12-16' },
    settings: { allowJuryParticipation: true },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['participant', 'participant'], ['juror', 'participant'], ['newcomer', 'participant']],
    overrides: [['organizer', 'sendMassMessage', false]],
  },
  {
    slug: 'demo-bnwiki-womens-history-2027',
    title: "Bangla Wikipedia Women's History Month 2027",
    description: 'Write and expand biographies of women on Bangla Wikipedia.',
    type: 'writing',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Bangla Wikipedia community',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: {
      registrationOpensAt: '2026-10-01', registrationClosesAt: '2027-02-28', startDate: '2027-03-01', endDate: '2027-03-31',
      submissionDeadline: '2027-03-31T23:59:00+06:00', reviewOpensAt: '2027-04-01', reviewDeadline: '2027-04-20', resultsAnnouncedAt: '2027-04-25',
    },
    settings: { minEditCount: 100, minAccountAgeDays: 30, participantLimit: 50, registrationRequired: true },
    typeConfig: { minWordCount: 300, minBytes: 3000, createdDuringEventOnly: true, allowExpansions: true },
    createdBy: 'bnadmin',
    members: [['organizer', 'organizer'], ['bnadmin', 'organizer'], ['juror', 'jury']],
  },
  {
    slug: 'demo-wiki-loves-food-2027',
    title: 'Wiki Loves Food Bangladesh 2027',
    description: 'Document the cuisine of Bangladesh on Wikimedia Commons.',
    type: 'photo',
    primaryWiki: 'commonswiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { registrationOpensAt: '2027-01-01', startDate: '2027-01-15', endDate: '2027-02-28', reviewDeadline: '2027-03-20' },
    typeConfig: { maxEntriesPerParticipant: 50, requiredCategory: 'Images from Wiki Loves Food 2027 in Bangladesh' },
    createdBy: 'bnadmin',
    members: [['bnadmin', 'organizer']],
  },
  {
    slug: 'demo-wikidata-heritage-sprint',
    title: 'Wikidata Bangladesh Heritage Sprint',
    description: 'Add coordinates, heritage designations and images to Wikidata items for protected sites.',
    type: 'data',
    primaryWiki: 'wikidatawiki',
    organizingCommunity: 'Wikidata Bangladesh',
    language: 'en',
    timezone: 'UTC',
    dates: { startDate: '2026-05-01T00:00:00Z', endDate: '2026-05-31T23:59:00Z' },
    settings: { juryReviewEnabled: false, contributionDiscoveryEnabled: true },
    typeConfig: { entityTypes: ['item'], requiredProperties: ['P17', 'P625', 'P1435'], minStatements: 3 },
    createdBy: 'juror',
    members: [['juror', 'organizer'], ['participant', 'participant'], ['organizer', 'participant']],
  },
  {
    slug: 'demo-wle-bangladesh-2026',
    title: 'Wiki Loves Earth 2026 in Bangladesh',
    description: 'Photograph protected natural areas of Bangladesh.',
    type: 'photo',
    primaryWiki: 'commonswiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { startDate: '2026-05-01', endDate: '2026-07-31', reviewDeadline: '2026-09-15', resultsAnnouncedAt: '2026-09-20' },
    typeConfig: { requiredCategory: 'Images from Wiki Loves Earth 2026 in Bangladesh', awardCategories: ['Best landscape', 'Best wildlife'] },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['juror', 'jury'], ['participant', 'participant']],
  },
  {
    slug: 'demo-folklore-meetup',
    title: 'Wiki Loves Folklore Dhaka Meetup',
    description: 'An in-person edit-a-thon that was called off.',
    type: 'editathon',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { startDate: '2026-12-05', endDate: '2026-12-05T18:00:00+06:00' },
    status: 'cancelled',
    createdBy: 'organizer',
    members: [['organizer', 'organizer']],
  },
  {
    slug: 'demo-enwiki-jury-calibration',
    title: 'Jury Calibration Round',
    description: 'A private dry run for training new jurors. Only members and platform-wide authorities can see it.',
    type: 'writing',
    visibility: 'private',
    primaryWiki: 'enwiki',
    language: 'en',
    timezone: 'UTC',
    dates: { startDate: '2027-01-10T00:00:00Z', endDate: '2027-01-20T00:00:00Z' },
    status: 'draft',
    createdBy: 'juror',
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

const log = (prisma, data) =>
  prisma.auditLog.create({ data: { ...data, entityId: String(data.entityId), details: JSON.stringify(data.details) } });

async function seedDemoData(prisma, now = new Date()) {
  await clearDemoData(prisma);

  const users = {};
  for (const [i, u] of DEMO_USERS.entries()) {
    const created = await prisma.user.create({
      data: {
        wikimediaId: -(i + 1),
        username: u.username,
        homeWiki: u.homeWiki,
        wikimediaRegisteredAt: d(u.registered),
        globalEditCount: u.edits,
        isDemo: true,
        wikiRoles: { create: (u.rights || []).map(([wiki, rightName]) => ({ wiki, rightName, verificationSource: 'demo' })) },
        globalRoles: { create: (u.platformRoles || []).map((role) => ({ role })) },
      },
    });
    users[u.key] = created;
    for (const role of u.platformRoles || []) {
      await log(prisma, { action: 'platformRole.granted', entityType: 'User', entityId: created.id, details: { role, username: u.username, via: 'seed' } });
    }
  }

  for (const c of DEMO_CONTESTS) {
    const creator = users[c.createdBy];
    const dates = Object.fromEntries(Object.entries(c.dates).map(([k, v]) => [k, d(v)]));
    const settings = {
      ...defaultSettings(c.type),
      ...c.settings,
      typeConfig: JSON.stringify({ ...readTypeConfig(c.type, '{}'), ...c.typeConfig }),
    };
    const status = c.status || computeAutoStatus(dates, settings, now);

    const contest = await prisma.contest.create({
      data: {
        slug: c.slug,
        title: c.title,
        description: c.description,
        type: c.type,
        status,
        statusMode: c.status === 'cancelled' ? 'manual' : 'auto',
        visibility: c.visibility || 'public',
        organizingCommunity: c.organizingCommunity || '',
        primaryWiki: c.primaryWiki,
        additionalWikis: JSON.stringify(c.additionalWikis || []),
        contactInfo: c.contactInfo || '',
        language: c.language,
        timezone: c.timezone,
        ...dates,
        isDemo: true,
        createdById: creator.id,
        settings: { create: settings },
        memberships: { create: c.members.map(([userKey, role]) => ({ userId: users[userKey].id, role, assignedById: creator.id })) },
        permissionOverrides: {
          create: (c.overrides || []).map(([userKey, permission, allowed]) => ({ userId: users[userKey].id, permission, allowed })),
        },
      },
    });

    const base = { actorId: creator.id, contestId: contest.id };
    await log(prisma, { ...base, action: 'contest.created', entityType: 'Contest', entityId: contest.id, details: { title: c.title, type: c.type } });
    for (const [userKey, role] of c.members) {
      if (users[userKey] === creator && role === 'organizer') continue;
      await log(prisma, { ...base, action: 'membership.added', entityType: 'User', entityId: users[userKey].id, details: { username: users[userKey].username, role } });
    }
    for (const [userKey, permission, allowed] of c.overrides || []) {
      await log(prisma, { ...base, action: 'contestPermission.set', entityType: 'User', entityId: users[userKey].id, details: { username: users[userKey].username, permission, allowed } });
    }
    if (status !== 'draft') {
      await log(prisma, { ...base, action: 'contest.statusChanged', entityType: 'Contest', entityId: contest.id, details: { from: 'draft', to: status, by: 'seed' } });
    }
  }

  return { users: DEMO_USERS.length, contests: DEMO_CONTESTS.length };
}

module.exports = { seedDemoData, clearDemoData, DEMO_USERS, DEMO_CONTESTS };

if (require.main === module) {
  require('dotenv').config();
  const prisma = require('../src/config/prisma');
  seedDemoData(prisma)
    .then(({ users, contests }) => console.log(`Seeded ${users} demo users and ${contests} demo events.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
