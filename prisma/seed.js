// Demo data for development. Safe to re-run: it replaces earlier demo data and
// never touches real users or events. Run with `npm run seed`.

const { computeAutoStatus } = require('../src/services/lifecycleService');
const { defaultSettings } = require('../src/services/contestFormService');
const { readTypeConfig } = require('../src/events/eventTypes');
const { defaultCode } = require('../src/services/eventWikiService');
const { seedFountain, realTitles } = require('./demoFountain');

// Recurring events: /<slug> lists every edition.
const DEMO_SERIES = [
  { slug: 'wam', title: 'Wikipedia Asian Month', description: 'Every November, Wikipedians around the world write articles about Asia in their own languages.' },
  { slug: 'wlm', title: 'Wiki Loves Monuments', description: 'The yearly photo contest for built heritage on Wikimedia Commons.' },
];

const DEMO_USERS = [
  { key: 'steward', username: 'Mahbub Alam', label: 'Steward', homeWiki: 'metawiki', registered: '2009-02-14', edits: 85210, rights: [['*', 'steward']] },
  { key: 'gsysop', username: 'Elena Varga', label: 'Global Sysop', homeWiki: 'enwiki', registered: '2011-06-01', edits: 42377, rights: [['*', 'global-sysop']] },
  { key: 'bnadmin', username: 'Tanvir Hossain', label: 'Bn Admin', homeWiki: 'bnwiki', registered: '2012-03-21', edits: 18450, rights: [['bnwiki', 'sysop']] },
  { key: 'padmin', username: 'Sadia Karim', label: 'Platform Admin', homeWiki: 'enwiki', registered: '2015-09-09', edits: 3120, platformRoles: ['platform-admin'] },
  { key: 'organizer', username: 'Nusrat Jahan', label: 'Organizer', homeWiki: 'bnwiki', registered: '2016-01-10', edits: 6204, platformRoles: ['event-creator'] },
  { key: 'juror', username: 'Farhan Ahmed', label: 'Juror', homeWiki: 'commonswiki', registered: '2014-07-30', edits: 9815 },
  { key: 'participant', username: 'Rakib Hasan', label: 'Participant', homeWiki: 'bnwiki', registered: '2019-11-02', edits: 2417 },
  { key: 'newcomer', username: 'Maliha Chowdhury', label: 'Newcomer', homeWiki: 'bnwiki', registered: '2026-08-15', edits: 12 },
  { key: 'blocked', username: 'Quick Uploads 77', label: 'Blocked', homeWiki: 'commonswiki', registered: '2026-09-28', edits: 41 },
];

// Dates are midnight in Dhaka unless a time is given.
const d = (s) => new Date(s.length === 10 ? `${s}T00:00:00+06:00` : s);

const DEMO_CONTESTS = [
  // Copied from Fountain: its articles, jury and marks are added by seedFountain.
  {
    slug: 'wam-2025',
    category: 'culture', mainCategory: 'উইকিপিডিয়া এশীয় মাস ২০২৫',
    series: 'wam',
    edition: '2025',
    title: 'উইকিপিডিয়া এশীয় মাস ২০২৫',
    description: 'নভেম্বর মাসজুড়ে এশিয়া বিষয়ক নতুন নিবন্ধ লেখার প্রতিযোগিতা। বাংলা উইকিপিডিয়ায় ১৩৭টি নিবন্ধ জমা পড়েছিল।',
    type: 'writing',
    resultsPublished: true,
    primaryWiki: 'bnwiki',
    organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়',
    contactInfo: 'উইকিপিডিয়া:উইকিপিডিয়া এশীয় মাস ২০২৫',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { startDate: '2025-11-01T00:00:00Z', endDate: '2025-11-30T23:59:59Z', submissionOpensAt: '2025-11-01T00:00:00Z', submissionDeadline: '2025-11-30T23:59:59Z', reviewDeadline: '2025-12-31T00:00:00Z', resultsAnnouncedAt: '2026-01-10T00:00:00Z' },
    settings: { allowJuryParticipation: false, wordCountEnabled: true },
    typeConfig: { createdDuringEventOnly: true },
    createdBy: 'organizer',
    members: [['organizer', 'organizer']],
  },
  {
    slug: 'wam-2026',
    category: 'culture', mainCategory: 'Wikipedia Asian Month 2026', previousEditionUrl: 'https://meta.wikimedia.org/wiki/Wikipedia_Asian_Month_2025',
    series: 'wam',
    edition: '2026',
    title: 'Wikipedia Asian Month 2026',
    description: 'Write or expand articles about Asia — its people, places, history and culture — in your language during November.',
    type: 'writing',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Wikipedia Asian Month team',
    contactInfo: 'meta:Wikipedia Asian Month 2026 (talk page)',
    language: 'en',
    timezone: 'UTC',
    dates: {
      registrationOpensAt: '2026-10-15T00:00:00Z', startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-30T23:59:00Z',
      submissionOpensAt: '2026-11-01T00:00:00Z', submissionDeadline: '2026-11-30T23:59:00Z',
      reviewOpensAt: '2026-12-01T00:00:00Z', reviewDeadline: '2026-12-20T00:00:00Z',
    },
    settings: { allowJuryParticipation: false, badgesEnabled: true, wordCountEnabled: true, contributionDiscoveryEnabled: true, trackHashtags: '["wam2026"]', marks: '[{"name":"Accepted","values":[{"label":"Yes","points":1},{"label":"No","points":0}]},{"name":"Quality","values":[{"label":"0","points":0},{"label":"1","points":1},{"label":"2","points":2},{"label":"3","points":3}]}]' },
    typeConfig: { minWordCount: 300, minBytes: 3000, createdDuringEventOnly: true },
    contributions: { count: 60, wikis: ['bnwiki', 'bnwiki', 'hiwiki', 'enwiki'], users: ['participant', 'newcomer'], hashtagUsers: ['Arif Rahman', 'Priya Sharma', 'Ken Watanabe'], from: '2026-11-01T00:00:00Z' },
    // [wiki, status, overrides, requested by]: each wiki may set its own rules, dates and contact.
    wikis: [
      ['bnwiki', 'active', { contest: { timezone: 'Asia/Dhaka', contactInfo: 'উইকিপিডিয়া:উইকিপিডিয়া এশীয় মাস ২০২৬' }, typeConfig: { minWordCount: 350, allowExpansions: true } }],
      ['hiwiki', 'active', { contest: { timezone: 'Asia/Kolkata' }, typeConfig: { minWordCount: 250 } }],
      ['enwiki', 'active', { settings: { minAccountAgeDays: 30 } }],
      ['jawiki', 'paused', { contest: { timezone: 'Asia/Tokyo' } }],
      ['tawiki', 'pending', {}, 'participant'],
    ],
    createdBy: 'organizer',
    // [user, role, wiki]: no wiki means the whole event.
    members: [
      ['organizer', 'organizer'], ['gsysop', 'organizer'],
      ['bnadmin', 'organizer', 'bnwiki'], ['bnadmin', 'jury', 'bnwiki'], ['juror', 'jury', 'enwiki'],
      ['participant', 'participant', 'bnwiki'], ['newcomer', 'participant', 'bnwiki'],
    ],
  },
  {
    slug: 'wlm-bangladesh-2026',
    category: 'heritage', mainCategory: 'Images from Wiki Loves Monuments 2026 in Bangladesh', previousEditionUrl: 'https://commons.wikimedia.org/wiki/Commons:Wiki_Loves_Monuments_2025_in_Bangladesh',
    series: 'wlm',
    edition: '2026',
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
    blocks: [['blocked', 'Uploaded other photographers’ work as their own.']],
  },
  {
    slug: 'liberation-war-editathon',
    category: 'history',
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
    slug: 'bnwiki-womens-history-2027',
    category: 'gender',
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
    slug: 'wiki-loves-food-2027',
    category: 'culture',
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
    slug: 'wikidata-heritage-sprint',
    category: 'heritage',
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
    slug: 'wle-bangladesh-2026',
    category: 'nature', mainCategory: 'Images from Wiki Loves Earth 2026 in Bangladesh',
    title: 'Wiki Loves Earth 2026 in Bangladesh',
    description: 'Photograph protected natural areas of Bangladesh.',
    type: 'photo',
    resultsPublished: true,
    primaryWiki: 'commonswiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { startDate: '2026-05-01', endDate: '2026-07-31', reviewDeadline: '2026-09-15', resultsAnnouncedAt: '2026-09-20' },
    settings: { marks: '[{"name":"Stars","values":[{"label":"★","points":1},{"label":"★★","points":2},{"label":"★★★","points":3},{"label":"★★★★","points":4},{"label":"★★★★★","points":5}]}]' },
    typeConfig: { requiredCategory: 'Images from Wiki Loves Earth 2026 in Bangladesh', awardCategories: ['Best landscape', 'Best wildlife'] },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['juror', 'jury'], ['participant', 'participant']],
  },
  {
    slug: 'wikipedia-basics-training',
    category: 'education',
    title: 'Bangla Wikipedia Basics Training',
    description: 'A four-week course for new editors: creating an account, editing, citing sources and writing a first article.',
    type: 'training',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    contactInfo: 'training@wikimedia.org.bd',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { registrationOpensAt: '2026-10-01', startDate: '2026-10-17', endDate: '2026-11-21T20:00:00+06:00' },
    settings: { contributionDiscoveryEnabled: true },
    typeConfig: { levels: ['beginner'], topics: ['Editing basics', 'Citing sources', 'Your first article'], minSessionsForCertificate: 2 },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['bnadmin', 'organizer'], ['participant', 'participant', 'bnwiki'], ['newcomer', 'participant', 'bnwiki'], ['juror', 'participant', 'bnwiki']],
    sessions: [
      { title: 'Week 1: Your account and first edits', mode: 'offline', startsAt: '2026-10-17T15:00:00+06:00', endsAt: '2026-10-17T18:00:00+06:00', location: 'Bishwo Shahitto Kendro, Dhaka', capacity: 30, status: 'held', report: '24 people came; 19 made their first edit during the session.', attendance: [['participant', 'attended'], ['newcomer', 'attended'], ['juror', 'absent']] },
      { title: 'Week 2: Citing sources', mode: 'online', startsAt: '2026-10-24T20:00:00+06:00', endsAt: '2026-10-24T21:30:00+06:00', meetingUrl: 'https://meet.jit.si/bnwiki-basics-week2', status: 'held', attendance: [['participant', 'attended'], ['newcomer', 'attended'], ['juror', 'attended']] },
      { title: 'Week 3: Writing a new article', mode: 'hybrid', startsAt: '2026-11-14T15:00:00+06:00', endsAt: '2026-11-14T18:00:00+06:00', location: 'Bishwo Shahitto Kendro, Dhaka', meetingUrl: 'https://meet.jit.si/bnwiki-basics-week3', capacity: 3, status: 'open', attendance: [['participant', 'registered'], ['newcomer', 'registered']] },
      { title: 'Week 4: Images and Wikimedia Commons', mode: 'online', startsAt: '2026-11-21T20:00:00+06:00', meetingUrl: 'https://meet.jit.si/bnwiki-basics-week4', status: 'planned', attendance: [] },
    ],
  },
  {
    slug: 'old-dhaka-photowalk',
    category: 'heritage', mainCategory: 'Old Dhaka Heritage Photowalk 2026',
    title: 'Old Dhaka Heritage Photowalk',
    description: 'Walk through Puran Dhaka with fellow photographers and upload what you capture to Wikimedia Commons.',
    type: 'photowalk',
    primaryWiki: 'commonswiki',
    organizingCommunity: 'Wikimedia Bangladesh',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { registrationOpensAt: '2026-10-15', startDate: '2026-10-31T07:00:00+06:00', endDate: '2026-11-15T23:59:00+06:00' },
    settings: { trackCategories: '["Old Dhaka Heritage Photowalk 2026"]' },
    typeConfig: { meetingPoint: 'Ahsan Manzil main gate', requiredCategory: 'Old Dhaka Heritage Photowalk 2026', uploadedDuringEventOnly: true },
    createdBy: 'organizer',
    members: [['organizer', 'organizer'], ['participant', 'participant', 'commonswiki'], ['newcomer', 'participant', 'commonswiki']],
    sessions: [
      { title: 'Morning walk: Ahsan Manzil to Lalbagh', mode: 'offline', startsAt: '2026-10-31T07:00:00+06:00', endsAt: '2026-10-31T11:00:00+06:00', location: 'Ahsan Manzil main gate', capacity: 25, status: 'held', report: '18 photographers; about 300 photos uploaded so far.', attendance: [['participant', 'attended'], ['newcomer', 'attended']] },
      { title: 'Second walk: Armenian Church and Shankhari Bazar', mode: 'offline', startsAt: '2026-11-08T07:00:00+06:00', endsAt: '2026-11-08T11:00:00+06:00', location: 'Armenian Church, Armanitola', capacity: 25, status: 'open', attendance: [['participant', 'registered']] },
    ],
  },
  {
    slug: 'citation-workshop',
    category: 'education',
    title: 'Online Workshop: Finding Reliable Sources',
    description: 'A one-evening workshop on finding and citing reliable sources in Bangla.',
    type: 'workshop',
    primaryWiki: 'bnwiki',
    organizingCommunity: 'Bangla Wikipedia community',
    language: 'bn',
    timezone: 'Asia/Dhaka',
    dates: { registrationOpensAt: '2026-11-01', startDate: '2026-11-20T20:00:00+06:00', endDate: '2026-11-20T22:00:00+06:00' },
    typeConfig: { topics: ['Reliable sources', 'Citation templates'], minSessionsForCertificate: 1 },
    createdBy: 'bnadmin',
    members: [['bnadmin', 'organizer'], ['participant', 'participant', 'bnwiki']],
    sessions: [
      { title: 'Finding reliable sources', mode: 'online', startsAt: '2026-11-20T20:00:00+06:00', endsAt: '2026-11-20T22:00:00+06:00', meetingUrl: 'https://meet.jit.si/bnwiki-sources-workshop', capacity: 50, status: 'open', attendance: [['participant', 'registered']] },
    ],
  },
  {
    slug: 'folklore-meetup',
    category: 'culture',
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
    slug: 'enwiki-jury-calibration',
    category: 'other',
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
  await clearDemoContests(prisma);
  await prisma.eventSeries.deleteMany({ where: { isDemo: true } });
}

async function clearDemoContests(prisma) {
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
        lastLoginAt: new Date(now.getTime() - (i * 9 + 2) * 3600000),
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

  const series = {};
  for (const sr of DEMO_SERIES) series[sr.slug] = await prisma.eventSeries.create({ data: { ...sr, isDemo: true } });

  for (const c of DEMO_CONTESTS) {
    const creator = users[c.createdBy];
    const wikis = c.wikis || [[c.primaryWiki, 'active', {}], ...(c.additionalWikis || []).map((w) => [w, 'active', {}])];
    const codes = await Promise.all(wikis.map(([wiki]) => defaultCode(wiki, prisma)));
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
        category: c.category || '',
        mainCategory: c.mainCategory || '',
        previousEditionUrl: c.previousEditionUrl || '',
        resultsPublishedAt: c.resultsPublished ? d(c.dates.resultsAnnouncedAt || c.dates.endDate) : null,
        primaryWiki: c.primaryWiki,
        additionalWikis: '[]',
        ...(c.series && { seriesId: series[c.series].id, edition: c.edition }),
        wikis: {
          create: wikis.map(([wiki, wikiStatus, overrides, requestedBy], i) => ({
            wiki,
            code: codes[i],
            status: wikiStatus,
            overrides: JSON.stringify(overrides || {}),
            requestedById: requestedBy ? users[requestedBy].id : null,
          })),
        },
        contactInfo: c.contactInfo || '',
        language: c.language,
        timezone: c.timezone,
        ...dates,
        isDemo: true,
        createdById: creator.id,
        settings: { create: settings },
        memberships: { create: c.members.map(([userKey, role, wiki = '']) => ({ userId: users[userKey].id, role, wiki, assignedById: creator.id })) },
        permissionOverrides: {
          create: (c.overrides || []).map(([userKey, permission, allowed]) => ({ userId: users[userKey].id, permission, allowed })),
        },
      },
    });

    const base = { actorId: creator.id, contestId: contest.id };
    await log(prisma, { ...base, action: 'contest.created', entityType: 'Contest', entityId: contest.id, details: { title: c.title, type: c.type } });
    for (const [userKey, role, wiki] of c.members) {
      if (users[userKey] === creator && role === 'organizer' && !wiki) continue;
      await log(prisma, { ...base, action: 'membership.added', entityType: 'User', entityId: users[userKey].id, details: { username: users[userKey].username, role, wiki } });
    }
    for (const [userKey, permission, allowed] of c.overrides || []) {
      await log(prisma, { ...base, action: 'contestPermission.set', entityType: 'User', entityId: users[userKey].id, details: { username: users[userKey].username, permission, allowed } });
    }
    for (const [userKey, reason] of c.blocks || []) {
      await prisma.eventBlock.create({ data: { contestId: contest.id, userId: users[userKey].id, reason, blockedById: creator.id } });
      await log(prisma, { ...base, action: 'eventBlock.added', entityType: 'User', entityId: users[userKey].id, details: { username: users[userKey].username, reason } });
    }
    for (const sess of c.sessions || []) {
      await prisma.eventSession.create({
        data: {
          contestId: contest.id,
          title: sess.title,
          mode: sess.mode,
          status: sess.status,
          startsAt: d(sess.startsAt),
          endsAt: sess.endsAt ? d(sess.endsAt) : null,
          location: sess.location || '',
          meetingUrl: sess.meetingUrl || '',
          capacity: sess.capacity ?? null,
          report: sess.report || '',
          attendances: {
            create: sess.attendance.map(([userKey, st]) => ({ userId: users[userKey].id, status: st, checkedInAt: st === 'attended' ? d(sess.startsAt) : null })),
          },
        },
      });
    }
    if (c.contributions) await seedContributions(prisma, contest, c.contributions, users, now);
    if (status !== 'draft') {
      await log(prisma, { ...base, action: 'contest.statusChanged', entityType: 'Contest', entityId: contest.id, details: { from: 'draft', to: status, by: 'seed' } });
    }
  }

  const submissions = (await seedSubmissions(prisma, users)) + (await seedFountain(prisma, users));
  await seedReviews(prisma, users);
  // Each entry's word count as a column, for sorting and totals.
  await prisma.$executeRawUnsafe(`UPDATE "Submission" SET "wordCount" = CAST(json_extract("metadata", '$.wordCount') AS INTEGER) WHERE json_extract("metadata", '$.wordCount') IS NOT NULL AND "contestId" IN (SELECT "id" FROM "Contest" WHERE "isDemo" = 1)`);
  return { users: DEMO_USERS.length, contests: DEMO_CONTESTS.length, submissions };
}

// Sample entries with stored metadata, so pages work without calling Wikimedia.
const thumb = (path) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;
const DEMO_SUBMISSIONS = [
  ['wam-2026', 'participant', 'সিল্ক রোড', 'article', 'validated', { wiki: 'bnwiki', sizeBytes: 21400, wordCount: 1530, createdAt: '2026-11-01T09:00:00Z' }],
  ['wam-2026', 'participant', 'Bagan temples', 'article', 'validated', { wiki: 'enwiki', sizeBytes: 9800, wordCount: 1040, createdAt: '2026-11-02T04:00:00Z' }],
  ['wam-2026', 'newcomer', 'অঙ্কোর বাট', 'article', 'invalid', { wiki: 'bnwiki', sizeBytes: 2100, wordCount: 190, createdAt: '2026-11-02T15:30:00Z' }, ['190 words is below the 350-word minimum.']],
  ['wlm-bangladesh-2026', 'participant', 'File:Shat Gombuj Mosque at dusk.jpg', 'file', 'approved', { file: { width: 6000, height: 4000, megapixels: 24, mime: 'image/jpeg', license: 'CC BY-SA 4.0', thumbUrl: thumb('a/a9/Example.jpg/500px-Example.jpg') }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Shat Gombuj Mosque'], createdAt: '2026-09-14T10:22:00Z' }],
  ['wlm-bangladesh-2026', 'participant', 'File:Lalbagh Fort south gate.jpg', 'file', 'validated', { file: { width: 4608, height: 3456, megapixels: 15.9, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Lalbagh Fort'], createdAt: '2026-10-02T07:45:00Z' }],
  ['wlm-bangladesh-2026', 'participant', 'File:Kantajew Temple terracotta detail.jpg', 'file', 'under_review', { file: { width: 5472, height: 3648, megapixels: 20, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh'], createdAt: '2026-10-19T12:10:00Z' }],
  ['wlm-bangladesh-2026', 'newcomer', 'File:Ahsan Manzil from the river.jpg', 'file', 'validated', { file: { width: 4000, height: 3000, megapixels: 12, mime: 'image/jpeg', license: 'CC BY 4.0' }, categories: ['Images from Wiki Loves Monuments 2026 in Bangladesh', 'Ahsan Manzil'], createdAt: '2026-10-25T16:30:00Z' }],
  ['wlm-bangladesh-2026', 'newcomer', 'File:Old building phone photo.jpg', 'file', 'invalid', { file: { width: 1280, height: 960, megapixels: 1.2, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: [], createdAt: '2026-10-26T09:00:00Z' }, ['Resolution 1.2 MP is below the 2 MP minimum.', 'Missing the required category “Images from Wiki Loves Monuments 2026 in Bangladesh”.']],
  ['liberation-war-editathon', 'participant', 'অপারেশন জ্যাকপট', 'article', 'validated', { sizeBytes: 18432, wordCount: 1210, createdAt: '2026-10-18T05:12:00Z' }],
  ['liberation-war-editathon', 'juror', 'মুজিবনগর সরকার', 'article', 'pending', { sizeBytes: 26210, wordCount: 1874, createdAt: '2014-02-11T08:00:00Z' }],
  ['liberation-war-editathon', 'newcomer', 'কলারোয়া যুদ্ধ', 'article', 'withdrawn', { sizeBytes: 2300, wordCount: 160, createdAt: '2026-10-30T14:40:00Z' }],
  ['wikidata-heritage-sprint', 'participant', 'Q1068467', 'item', 'approved', { entity: { id: 'Q1068467', type: 'item', label: 'Shat Gambuj Mosque', description: 'mosque in Bagerhat, Bangladesh', properties: ['P31', 'P17', 'P625', 'P1435', 'P18'], statementCount: 14 } }],
  ['wikidata-heritage-sprint', 'organizer', 'Q2329733', 'item', 'approved', { entity: { id: 'Q2329733', type: 'item', label: 'Lalbagh Fort', description: 'Mughal fort in Dhaka', properties: ['P31', 'P17', 'P625', 'P1435'], statementCount: 9 } }],
  ['wle-bangladesh-2026', 'participant', 'File:Sundarbans mangrove at low tide.jpg', 'file', 'approved', { file: { width: 6720, height: 4480, megapixels: 30.1, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Earth 2026 in Bangladesh'], createdAt: '2026-06-08T03:20:00Z' }],
  ['wle-bangladesh-2026', 'participant', 'File:Lawachara forest canopy.jpg', 'file', 'rejected', { file: { width: 4000, height: 2250, megapixels: 9, mime: 'image/jpeg', license: 'CC BY-SA 4.0' }, categories: ['Images from Wiki Loves Earth 2026 in Bangladesh'], createdAt: '2026-07-02T06:00:00Z' }],
];

async function seedSubmissions(prisma, users) {
  const { pageUrl } = require('../src/wiki/wikiUrls');
  let n = 0;
  for (const [slug, userKey, title, entryType, status, extra, errors = []] of DEMO_SUBMISSIONS) {
    const contest = await prisma.contest.findUnique({ where: { slug } });
    const wiki = extra.wiki || (entryType === 'item' ? 'wikidatawiki' : contest.primaryWiki);
    const pageId = 900000 + n;
    const meta = { exists: true, wiki, pageId, ns: entryType === 'file' ? 6 : 0, title, url: pageUrl(wiki, title), entryType, creator: users[userKey].username, categories: [], ...extra };
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
  return n + (await seedBulkSubmissions(prisma, users));
}

// Tracked edits for an event: participants' edits and edits tagged with the hashtag.
async function seedContributions(prisma, contest, spec, users, now) {
  const rand = prng(77);
  // Real article titles on each wiki (from the Fountain copy).
  const titles = realTitles();
  const titleOn = (wiki, i) => {
    const list = titles.filter((x) => x.wiki === wiki);
    return list.length ? list[i % list.length].title : `Asia topic ${i}`;
  };
  const from = new Date(spec.from).getTime();
  const span = Math.max(3600000, now.getTime() - from);
  const rows = [];
  for (let i = 1; i <= spec.count; i++) {
    const wiki = spec.wikis[i % spec.wikis.length];
    const byParticipant = rand() < 0.6;
    const username = byParticipant ? users[spec.users[i % spec.users.length]].username : spec.hashtagUsers[i % spec.hashtagUsers.length];
    const isNew = rand() < 0.35;
    rows.push({
      contestId: contest.id,
      wiki,
      key: `${wiki}:rev:${70000000 + i}`,
      source: byParticipant ? 'participant' : 'hashtag',
      username,
      userId: byParticipant ? users[spec.users[i % spec.users.length]].id : null,
      pageTitle: titleOn(wiki, i),
      ns: 0,
      revId: 70000000 + i,
      isNew,
      sizeDiff: Math.round((isNew ? 2500 : 80) + rand() * (isNew ? 12000 : 1500)),
      comment: byParticipant ? 'expanded' : 'New article #wam2026',
      timestamp: new Date(from + rand() * span),
    });
  }
  await prisma.contribution.createMany({ data: rows });
  await prisma.contestSettings.update({ where: { contestId: contest.id }, data: { trackedAt: now } });
}

// Jury work: some WAM entries reviewed on bnwiki and enwiki, star scores for the
// finished WLE, and an open appeal on WLM.
async function seedReviews(prisma, users) {
  const rand = prng(42);
  const wam = await prisma.contest.findUnique({ where: { slug: 'wam-2026' } });
  for (const [wiki, juror, count] of [['bnwiki', 'bnadmin', 8], ['enwiki', 'juror', 4]]) {
    const entries = await prisma.submission.findMany({ where: { contestId: wam.id, wiki, status: 'validated' }, orderBy: { id: 'asc' }, take: count });
    for (const e of entries) {
      const accept = rand() < 0.8;
      const quality = accept ? 1 + Math.floor(rand() * 3) : 0;
      const points = (accept ? 1 : 0) + quality;
      await prisma.review.create({
        data: {
          contestId: wam.id, submissionId: e.id, jurorId: users[juror].id, decision: accept ? 'accept' : 'reject',
          marks: JSON.stringify({ Accepted: accept ? 'Yes' : 'No', Quality: String(quality) }), points,
          comment: accept ? '' : 'Mostly a translation without sources.',
        },
      });
      await prisma.submission.update({
        where: { id: e.id },
        data: {
          status: accept ? 'approved' : 'rejected', score: points,
          history: { create: { actorId: users[juror].id, action: 'reviewed', previousValue: 'validated', newValue: accept ? 'approved' : 'rejected', note: '1/1' } },
        },
      });
    }
  }

  const wle = await prisma.contest.findUnique({ where: { slug: 'wle-bangladesh-2026' } });
  const approved = await prisma.submission.findMany({ where: { contestId: wle.id, status: 'approved' }, select: { id: true } });
  for (const e of approved) {
    const stars = 2 + Math.floor(rand() * 4);
    await prisma.review.create({ data: { contestId: wle.id, submissionId: e.id, jurorId: users.juror.id, decision: 'accept', marks: JSON.stringify({ Stars: '★'.repeat(stars) }), points: stars } });
    await prisma.submission.update({ where: { id: e.id }, data: { score: stars } });
  }

  const wlm = await prisma.contest.findUnique({ where: { slug: 'wlm-bangladesh-2026' } });
  // WLM shares its entries out: two reviews each, split between its two jury members.
  await prisma.contestSettings.update({ where: { contestId: wlm.id }, data: { reviewAssignment: 'assigned', requiredReviews: 2 } });
  const waiting = await prisma.submission.findMany({ where: { contestId: wlm.id, status: { in: ['validated', 'under_review'] } }, select: { id: true, participantId: true } });
  const wlmJury = [users.juror.id, users.bnadmin.id];
  await prisma.reviewAssignment.createMany({
    data: waiting.flatMap((e) => wlmJury.filter((j) => j !== e.participantId).map((jurorId) => ({ contestId: wlm.id, submissionId: e.id, jurorId, assignedById: users.organizer.id }))),
  });
  const rejected = await prisma.submission.findFirst({ where: { contestId: wlm.id, participantId: users.participant.id, status: 'rejected' } });
  if (rejected) {
    await prisma.appeal.create({ data: { contestId: wlm.id, submissionId: rejected.id, userId: users.participant.id, reason: 'The monument is listed in the national heritage register; the category was added the day after uploading.' } });
    await prisma.submission.update({
      where: { id: rejected.id },
      data: { status: 'appealed', history: { create: { actorId: users.participant.id, action: 'appealed', previousValue: 'rejected', newValue: 'appealed' } } },
    });
  }
}

// Deterministic pseudo-random numbers, so every re-seed produces the same data.
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Volume for the charts: many entries spread over each event's dates.
const BULK = [
  { slug: 'wlm-bangladesh-2026', count: 72, who: ['participant', 'newcomer', 'participant'], type: 'file', title: (i) => `File:WLM Bangladesh 2026 heritage site ${String(i).padStart(3, '0')}.jpg`, from: '2026-09-01', mix: { validated: 45, under_review: 20, approved: 18, rejected: 9, invalid: 8 } },
  { slug: 'liberation-war-editathon', count: 34, who: ['participant', 'juror', 'newcomer'], type: 'article', title: (i) => `মুক্তিযুদ্ধ নিবন্ধ ${i}`, from: '2026-10-15', mix: { validated: 70, pending: 20, withdrawn: 10 } },
  { slug: 'wle-bangladesh-2026', count: 48, who: ['participant'], type: 'file', title: (i) => `File:WLE Bangladesh 2026 nature ${String(i).padStart(3, '0')}.jpg`, from: '2026-05-01', mix: { approved: 55, rejected: 35, disqualified: 10 } },
  { slug: 'wikidata-heritage-sprint', count: 28, who: ['participant', 'organizer'], type: 'item', title: (i) => `Q${7000000 + i * 37}`, from: '2026-05-01', mix: { approved: 80, rejected: 20 } },
];

function pick(mix, r) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  let x = r * total;
  for (const [k, w] of Object.entries(mix)) if ((x -= w) < 0) return k;
  return Object.keys(mix)[0];
}

async function seedBulkSubmissions(prisma, users, now = new Date()) {
  const { pageUrl } = require('../src/wiki/wikiUrls');
  let n = 0;
  for (const [b, spec] of BULK.entries()) {
    const rand = prng(1000 + b);
    const contest = await prisma.contest.findUnique({ where: { slug: spec.slug } });
    const from = new Date(`${spec.from}T00:00:00Z`).getTime();
    const to = Math.min(contest.endDate.getTime(), now.getTime());
    const rows = [];
    for (let i = 1; i <= spec.count; i++) {
      const wiki = spec.wikis ? spec.wikis[i % spec.wikis.length] : spec.type === 'item' ? 'wikidatawiki' : contest.primaryWiki;
      // Skewed toward later days, like real contests that pick up near the deadline.
      const submittedAt = new Date(from + Math.pow(rand(), 0.7) * (to - from));
      const userKey = spec.who[Math.floor(rand() * spec.who.length)];
      const status = pick(spec.mix, rand());
      const title = spec.title(i);
      const mp = Math.round((4 + rand() * 30) * 10) / 10;
      const meta = {
        exists: true, wiki, pageId: 800000 + b * 1000 + i, ns: spec.type === 'file' ? 6 : 0, title, url: pageUrl(wiki, title), entryType: spec.type,
        createdAt: new Date(submittedAt.getTime() - 3600000).toISOString(), categories: [],
        ...(spec.type === 'file' && { file: { width: Math.round(Math.sqrt(mp * 1.5e6)), height: Math.round(Math.sqrt(mp * 1e6 / 1.5)), megapixels: mp, mime: 'image/jpeg', license: 'CC BY-SA 4.0' } }),
        ...(spec.type === 'article' && { sizeBytes: Math.round(3000 + rand() * 30000), wordCount: Math.round(300 + rand() * 2500) }),
        ...(spec.type === 'item' && { entity: { id: title, type: 'item', label: `Heritage site ${i}`, properties: ['P31', 'P17', 'P625', 'P1435'], statementCount: 4 + Math.floor(rand() * 12) } }),
      };
      rows.push({
        contestId: contest.id,
        participantId: users[userKey].id,
        submittedById: users[userKey].id,
        wiki,
        title,
        url: meta.url,
        pageKey: spec.type === 'item' ? `wikidata:${title}` : `${wiki}:${meta.pageId}`,
        entryType: spec.type,
        status,
        metadata: JSON.stringify(meta),
        validation: JSON.stringify({ errors: status === 'invalid' ? ['Resolution is below the minimum.'] : [], warnings: [] }),
        checkedAt: submittedAt,
        submittedAt,
      });
    }
    await prisma.submission.createMany({ data: rows });
    n += rows.length;
  }
  return n;
}

module.exports = { seedDemoData, clearDemoData, DEMO_USERS, DEMO_CONTESTS };

if (require.main === module) {
  require('dotenv').config();
  const prisma = require('../src/config/prisma');
  seedDemoData(prisma)
    .then(({ users, contests, submissions }) => console.log(`Seeded ${users} users, ${contests} events and ${submissions} submissions of sample data.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
