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

  const submissions = await seedSubmissions(prisma, users);
  return { users: DEMO_USERS.length, contests: DEMO_CONTESTS.length, submissions };
}

// Sample entries with stored metadata, so pages work without calling Wikimedia.
const thumb = (path) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;
const DEMO_SUBMISSIONS = [
  ['demo-wlm-bangladesh-2026', 'participant', 'File:Shat Gombuj Mosque at dusk.jpg', 'file', 'approved', { file: { width: 6000, height: 4000, megapixels: 24, mime: 'image/jpeg', license: 'CC BY-SA 4.0', thumbUrl: thumb('a/a9/Example.jpg/500px-Example.jpg') }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Shat Gombuj Mosque'], createdAt: '2026-09-14T10:22:00Z' }],
  ['demo-wlm-bangladesh-2026', 'participant', 'File:Lalbagh Fort south gate.jpg', 'file', 'validated', { file: { width: 4608, height: 3456, megapixels: 15.9, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Lalbagh Fort'], createdAt: '2026-10-02T07:45:00Z' }],
  ['demo-wlm-bangladesh-2026', 'participant', 'File:Kantajew Temple terracotta detail.jpg', 'file', 'under_review', { file: { width: 5472, height: 3648, megapixels: 20, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh'], createdAt: '2026-10-19T12:10:00Z' }],
  ['demo-wlm-bangladesh-2026', 'newcomer', 'File:Ahsan Manzil from the river.jpg', 'file', 'validated', { file: { width: 4000, height: 3000, megapixels: 12, mime: 'image/jpeg', license: 'CC BY 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Ahsan Manzil'], createdAt: '2026-10-25T16:30:00Z' }],
  ['demo-wlm-bangladesh-2026', 'newcomer', 'File:Old building phone photo.jpg', 'file', 'invalid', { file: { width: 1280, height: 960, megapixels: 1.2, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: [], createdAt: '2026-10-26T09:00:00Z' }, ['Resolution 1.2 MP is below the 2 MP minimum.', 'Missing the required category “Images from Wiki Loves Monuments 2026 in Bangladesh”.']],
  ['demo-liberation-war-editathon', 'participant', 'অপারেশন জ্যাকপট', 'article', 'validated', { sizeBytes: 18432, wordCount: 1210, createdAt: '2026-10-18T05:12:00Z' }],
  ['demo-liberation-war-editathon', 'juror', 'মুজিবনগর সরকার', 'article', 'pending', { sizeBytes: 26210, wordCount: 1874, createdAt: '2014-02-11T08:00:00Z' }],
  ['demo-liberation-war-editathon', 'newcomer', 'কলারোয়া যুদ্ধ', 'article', 'withdrawn', { sizeBytes: 2300, wordCount: 160, createdAt: '2026-10-30T14:40:00Z' }],
  ['demo-wikidata-heritage-sprint', 'participant', 'Q1068467', 'item', 'approved', { entity: { id: 'Q1068467', type: 'item', label: 'Shat Gambuj Mosque', description: 'mosque in Bagerhat, Bangladesh', properties: ['P31', 'P17', 'P625', 'P1435', 'P18'], statementCount: 14 } }],
  ['demo-wikidata-heritage-sprint', 'organizer', 'Q2329733', 'item', 'approved', { entity: { id: 'Q2329733', type: 'item', label: 'Lalbagh Fort', description: 'Mughal fort in Dhaka', properties: ['P31', 'P17', 'P625', 'P1435'], statementCount: 9 } }],
  ['demo-wle-bangladesh-2026', 'participant', 'File:Sundarbans mangrove at low tide.jpg', 'file', 'approved', { file: { width: 6720, height: 4480, megapixels: 30.1, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Earth 2026 in Bangladesh'], createdAt: '2026-06-08T03:20:00Z' }],
  ['demo-wle-bangladesh-2026', 'participant', 'File:Lawachara forest canopy.jpg', 'file', 'rejected', { file: { width: 4000, height: 2250, megapixels: 9, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Earth 2026 in Bangladesh'], createdAt: '2026-07-02T06:00:00Z' }],
];

async function seedSubmissions(prisma, users) {
  const { pageUrl } = require('../src/wiki/wikiUrls');
  let n = 0;
  for (const [slug, userKey, title, entryType, status, extra, errors = []] of DEMO_SUBMISSIONS) {
    const contest = await prisma.contest.findUnique({ where: { slug } });
    const wiki = entryType === 'item' ? 'wikidatawiki' : contest.primaryWiki;
    const pageId = 900000 + n;
    const meta = { exists: true, wiki, pageId, ns: entryType === 'file' ? 6 : 0, title, url: pageUrl(wiki, title), entryType, creator: users[userKey].username.replace(' (demo)', ''), categories: [], ...extra };
    const submittedAt = new Date(meta.createdAt ? new Date(meta.createdAt).getTime() + 3600000 : contest.startDate.getTime() + 86400000 * (n + 1));
    const history = [{ actorId: users[userKey].id, action: 'submitted', newValue: errors.length ? 'invalid' : 'validated', createdAt: submittedAt }];
    if (!['validated', 'invalid'].includes(status)) {
      const reviewer = status === 'withdrawn' ? users[userKey] : users[contest.createdById === users.juror.id ? 'juror' : 'organizer'];
      history.push({ actorId: reviewer.id, action: status === 'withdrawn' ? 'withdrawn' : 'status_changed', previousValue: 'validated', newValue: status, createdAt: new Date(submittedAt.getTime() + 2 * 86400000) });
    }
    await prisma.submission.create({
      data: {
        contestId: contest.id,
        participantId: users[userKey].id,
        submittedById: users[userKey].id,
        wiki,
        title,
        url: meta.url,
        pageKey: entryType === 'item' ? `wikidata:${title}` : `${wiki}:${pageId}`,
        entryType,
        status,
        metadata: JSON.stringify(meta),
        validation: JSON.stringify({ errors, warnings: [] }),
        checkedAt: submittedAt,
        submittedAt,
        history: { create: history },
      },
    });
    n += 1;
  }
  return n;
}

module.exports = { seedDemoData, clearDemoData, DEMO_USERS, DEMO_CONTESTS };

if (require.main === module) {
  require('dotenv').config();
  const prisma = require('../src/config/prisma');
  seedDemoData(prisma)
    .then(({ users, contests, submissions }) => console.log(`Seeded ${users} demo users, ${contests} demo events and ${submissions} submissions.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
