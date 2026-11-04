// Demo data: real events copied from Fountain (fountain.toolforge.org) and saved in
// prisma/demo/fountain.json, so seeding works offline. Their articles, writers, jury
// and the jury's marks are as they were on Fountain. Fountain doesn't record who
// organized an event, so each event's first listed jury member is shown as its
// organizer. Safe to re-run: it replaces earlier demo data and never touches real
// users or events. Run with `npm run seed`.

const { computeAutoStatus } = require('../src/services/lifecycleService');
const { defaultSettings } = require('../src/services/contestFormService');
const { readTypeConfig } = require('../src/events/eventTypes');
const { pageUrl } = require('../src/wiki/wikiUrls');
const FOUNTAIN = require('./demo/fountain.json');

const byCode = (code) => FOUNTAIN.editathons.find((e) => e.code === code);
const dbOf = (lang) => `${lang}wiki`;

const DEMO_SERIES = [
  { slug: 'wam', title: 'Wikipedia Asian Month', description: 'Every November, Wikipedians around the world write articles about Asia in their own languages.' },
];

// Each event: one or more Fountain editathons, one per wiki.
const DEMO_EVENTS = [
  { slug: 'wam-2026', series: 'wam', edition: '2026', title: 'Wikipedia Asian Month 2026', parts: ['asian-month-2026-bn', 'asian-month-2026-en', 'asian-month-2026-ne', 'as-asianmonth26', 'wam-kn-2026'],
    description: 'Write articles about Asia — its people, places, history and culture — in your language during November.', organizingCommunity: 'Wikipedia Asian Month team', language: 'en', timezone: 'UTC' },
  { slug: 'wam-2025', series: 'wam', edition: '2025', parts: ['asian-month-2025-bn'], organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়', contactInfo: 'উইকিপিডিয়া:উইকিপিডিয়া এশীয় মাস ২০২৫' },
  { slug: 'ekushey-2026', parts: ['ekushey26'], organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়', category: 'history' },
  { slug: 'feminism-folklore-2026-bn', parts: ['fnf2026-bn'], organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়', category: 'culture' },
  // Most of its entries are still waiting for the jury: its review stays open.
  { slug: 'fifa-world-cup-2026-bn', parts: ['fifa2026'], reviewOpen: true, organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়', category: 'sports' },
  { slug: 'sharodiyo-2026', parts: ['2026'], organizingCommunity: 'বাংলা উইকিপিডিয়া সম্প্রদায়', category: 'culture' },
];

async function clearDemoData(prisma) {
  const [users, contests] = await Promise.all([
    prisma.user.findMany({ where: { isDemo: true }, select: { id: true } }),
    prisma.contest.findMany({ where: { isDemo: true }, select: { id: true } }),
  ]);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users.map((u) => u.id) } }, { contestId: { in: contests.map((c) => c.id) } }] } });
  await prisma.contest.deleteMany({ where: { isDemo: true } });
  await prisma.user.deleteMany({ where: { isDemo: true } });
  await prisma.eventSeries.deleteMany({ where: { isDemo: true } });
}

// Fountain marks → Zury marks: { name, values: [{ label, points }] }.
const schemeOf = (e) => Object.values(e.marks).map((m) => ({ name: m.title, values: m.values.map((v) => ({ label: v.title, points: v.value })) }));

async function seedDemoData(prisma, now = new Date()) {
  await clearDemoData(prisma);

  // Everyone named in these events; someone with a real Zury account is used as is.
  const people = {};
  const person = async (username) => {
    if (!people[username]) {
      people[username] =
        (await prisma.user.findUnique({ where: { username } })) ||
        (await prisma.user.create({ data: { wikimediaId: -(Object.keys(people).length + 1), username, isDemo: true } }));
    }
    return people[username];
  };

  const series = {};
  for (const sr of DEMO_SERIES) series[sr.slug] = await prisma.eventSeries.create({ data: { ...sr, isDemo: true } });

  let entries = 0;
  for (const ev of DEMO_EVENTS) {
    const parts = ev.parts.map(byCode);
    const main = parts[0];
    const scheme = schemeOf(main);
    const at = (s) => new Date(s);
    const dates = { startDate: at(main.start), endDate: at(main.finish), submissionOpensAt: at(main.start), submissionDeadline: at(main.finish) };
    // Fountain has no review dates: two weeks for the jury, results a week later.
    const day = 86400000;
    dates.reviewOpensAt = dates.endDate;
    dates.reviewDeadline = ev.reviewOpen ? new Date(now.getTime() + 30 * day) : new Date(dates.endDate.getTime() + 14 * day);
    dates.resultsAnnouncedAt = new Date(dates.reviewDeadline.getTime() + 7 * day);
    const settings = {
      ...defaultSettings('writing'),
      wordCountEnabled: parts.some((pt) => pt.articles.some((a) => a.words != null)),
      marks: JSON.stringify(scheme),
      requiredReviews: main.minMarks || 1,
      typeConfig: JSON.stringify({ ...readTypeConfig('writing', '{}'), createdDuringEventOnly: true }),
    };
    const status = computeAutoStatus(dates, settings, now);
    const organizer = await person(main.jury[0]);
    // A wiki whose Fountain event has other dates keeps them as its own.
    const wikis = parts.map((p) => {
      const own = p.start !== main.start || p.finish !== main.finish;
      return {
        wiki: dbOf(p.wiki), code: p.wiki, status: 'active',
        overrides: JSON.stringify(own ? { contest: { startDate: p.start, endDate: p.finish, submissionOpensAt: p.start, submissionDeadline: p.finish } } : {}),
      };
    });
    const contest = await prisma.contest.create({
      data: {
        slug: ev.slug, title: ev.title || main.name, description: ev.description || main.description || '', type: 'writing', status, statusMode: 'auto', visibility: 'public',
        organizingCommunity: ev.organizingCommunity || '', category: ev.category || 'culture', contactInfo: ev.contactInfo || '',
        primaryWiki: dbOf(main.wiki), additionalWikis: '[]', language: ev.language || main.wiki, timezone: ev.timezone || 'Asia/Dhaka',
        ...dates,
        resultsPublishedAt: status === 'completed' ? dates.resultsAnnouncedAt : null,
        ...(ev.series && { seriesId: series[ev.series].id, edition: ev.edition }),
        isDemo: true, createdById: organizer.id,
        settings: { create: settings },
        wikis: { create: wikis },
      },
    });

    // Organizer (event-wide), then each wiki's jury and writers.
    const memberships = new Map();
    const member = (userId, role, wiki) => memberships.set(`${userId}:${role}:${wiki}`, { contestId: contest.id, userId, role, wiki, assignedById: organizer.id });
    member(organizer.id, 'organizer', '');
    for (const p of parts) {
      const wiki = parts.length > 1 ? dbOf(p.wiki) : '';
      for (const name of p.jury) member((await person(name)).id, 'jury', wiki);
      for (const a of p.articles) member((await person(a.user)).id, 'participant', wiki);
    }
    await prisma.contestMembership.createMany({ data: [...memberships.values()] });

    for (const p of parts) {
      const wiki = dbOf(p.wiki);
      for (const a of p.articles) {
        const writer = await person(a.user);
        const submittedAt = at(a.dateAdded);
        const reviews = [];
        for (const m of a.marks) {
          const value = scheme[0].values.find((v) => v.points === m.marks['0']) || scheme[0].values[scheme[0].values.length - 1];
          reviews.push({ contestId: contest.id, jurorId: (await person(m.user)).id, decision: value.points > 0 ? 'accept' : 'reject', marks: JSON.stringify({ [scheme[0].name]: value.label }), points: value.points, comment: m.comment || '' });
        }
        // One review per jury member and entry.
        const unique = [...new Map(reviews.map((r) => [r.jurorId, r])).values()];
        const accepted = unique.filter((r) => r.decision === 'accept').length;
        const decided = unique.length >= (main.minMarks || 1);
        const meta = { exists: true, wiki, ns: 0, title: a.name, url: pageUrl(wiki, a.name), entryType: 'article', creator: a.user, createdAt: a.dateAdded, ...(a.pageId && { pageId: a.pageId }), ...(a.words != null && { wordCount: a.words }), ...(a.bytes != null && { sizeBytes: a.bytes }) };
        await prisma.submission.create({
          data: {
            contestId: contest.id, participantId: writer.id, submittedById: writer.id, wiki, title: a.name, url: meta.url,
            pageKey: a.pageId ? `${wiki}:${a.pageId}` : `${wiki}:fountain-${a.id}`, entryType: 'article',
            status: !unique.length ? 'validated' : !decided ? 'under_review' : accepted * 2 > unique.length ? 'approved' : 'rejected',
            score: decided ? unique.reduce((s, r) => s + r.points, 0) / unique.length : null,
            wordCount: a.words ?? null,
            metadata: JSON.stringify(meta), validation: JSON.stringify({ errors: [], warnings: [] }), checkedAt: submittedAt, submittedAt,
            reviews: { create: unique },
          },
        });
        entries += 1;
      }
    }
  }
  return { users: Object.keys(people).length, contests: DEMO_EVENTS.length, submissions: entries };
}

module.exports = { seedDemoData, clearDemoData, DEMO_EVENTS };

if (require.main === module) {
  require('dotenv').config();
  const prisma = require('../src/config/prisma');
  seedDemoData(prisma)
    .then(({ users, contests, submissions }) => console.log(`Seeded ${contests} events from Fountain with ${submissions} entries and ${users} people.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
