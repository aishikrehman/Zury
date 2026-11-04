// Real projects copied from Fountain (fountain.toolforge.org), saved in
// prisma/demo/fountain.json so seeding works offline:
//   • Wikipedia Asian Month 2025 on Bangla Wikipedia, cloned as /wam/2025 with
//     its real articles, writers, jury and Fountain's own marks;
//   • real articles from the 2025 editions (bn, en, hi) as the entries waiting
//     for the WAM 2026 jury, so the review window shows real wiki pages.
const FOUNTAIN = require('./demo/fountain.json');

const byCode = (code) => FOUNTAIN.editathons.find((e) => e.code === code);
const WIKI = { bn: 'bnwiki', en: 'enwiki', hi: 'hiwiki' };

// Fountain marks → Zury marks: { name, values: [{ label, points }] }.
function scheme(e) {
  return Object.values(e.marks).map((m) => ({ name: m.title, values: m.values.map((v) => ({ label: v.title, points: v.value })) }));
}

// Demo accounts for the real people in these projects. Someone who already has a
// real Zury account is used as is. IDs from -1000 down keep them out of the
// demo-user switcher.
async function people(prisma) {
  const names = new Set();
  for (const e of FOUNTAIN.editathons) {
    e.jury.forEach((n) => names.add(n));
    for (const a of e.articles) {
      names.add(a.user);
      a.marks.forEach((m) => names.add(m.user));
    }
  }
  const out = {};
  let i = 0;
  for (const username of names) {
    i += 1;
    out[username] =
      (await prisma.user.findUnique({ where: { username } })) ||
      (await prisma.user.create({ data: { wikimediaId: -1000 - i, username, homeWiki: 'bnwiki', isDemo: true } }));
  }
  return out;
}

const articleMeta = (wiki, a, pageUrl, createdAt) => ({
  exists: true, wiki, pageId: a.id, ns: 0, title: a.name, url: pageUrl(wiki, a.name), entryType: 'article', creator: a.user, categories: [], createdAt,
});

async function seedFountain(prisma, users) {
  const { pageUrl } = require('../src/wiki/wikiUrls');
  const who = await people(prisma);

  // ── /wam/2025: the finished Bangla edition, as it was on Fountain ──
  const bn = byCode('asian-month-2025-bn');
  const wam25 = await prisma.contest.findUnique({ where: { slug: 'wam-2025' } });
  const marks = scheme(bn);
  await prisma.contestSettings.update({ where: { contestId: wam25.id }, data: { marks: JSON.stringify(marks), requiredReviews: bn.minMarks || 1 } });
  for (const name of bn.jury) {
    await prisma.contestMembership.create({ data: { contestId: wam25.id, userId: who[name].id, role: 'jury', assignedById: users.organizer.id } });
  }
  for (const writer of new Set(bn.articles.map((a) => a.user))) {
    await prisma.contestMembership.create({ data: { contestId: wam25.id, userId: who[writer].id, role: 'participant' } });
  }
  for (const a of bn.articles) {
    const submittedAt = new Date(a.dateAdded);
    const reviews = a.marks.map((m) => {
      const value = marks[0].values.find((v) => v.points === m.marks['0']) || marks[0].values[1];
      return { contestId: wam25.id, jurorId: who[m.user].id, decision: value.points > 0 ? 'accept' : 'reject', marks: JSON.stringify({ [marks[0].name]: value.label }), points: value.points, comment: m.comment };
    });
    const accepted = reviews.filter((r) => r.decision === 'accept').length;
    const decided = reviews.length > 0;
    const status = !decided ? 'validated' : accepted * 2 > reviews.length ? 'approved' : 'rejected';
    await prisma.submission.create({
      data: {
        contestId: wam25.id, participantId: who[a.user].id, submittedById: who[a.user].id, wiki: 'bnwiki', title: a.name,
        url: pageUrl('bnwiki', a.name), pageKey: `bnwiki:${a.id}`, entryType: 'article', status,
        score: decided ? reviews.reduce((s, r) => s + r.points, 0) / reviews.length : null,
        metadata: JSON.stringify(articleMeta('bnwiki', a, pageUrl, a.dateAdded)),
        validation: JSON.stringify({ errors: [], warnings: [] }), checkedAt: submittedAt, submittedAt,
        reviews: { create: reviews },
        history: { create: [{ actorId: who[a.user].id, action: 'submitted', newValue: 'validated', createdAt: submittedAt }] },
      },
    });
  }

  // ── WAM 2026: real articles waiting for the jury on each wiki ──
  const wam26 = await prisma.contest.findUnique({ where: { slug: 'wam-2026' } });
  const start = wam26.startDate.getTime();
  const span = Math.max(86400000, Math.min(Date.now(), wam26.endDate.getTime()) - start);
  const entries = [
    ...bn.articles.slice(-40).map((a) => ['bn', a]),
    ...byCode('asian-month-2025-en').articles.slice(0, 40).map((a) => ['en', a]),
    ...byCode('asian-month-2025-hi').articles.map((a) => ['hi', a]),
  ];
  const rows = entries.map(([lang, a], i) => {
    const wiki = WIKI[lang];
    const submittedAt = new Date(start + ((i * 7919) % 1000) / 1000 * span);
    return {
      contestId: wam26.id, participantId: who[a.user].id, submittedById: who[a.user].id, wiki, title: a.name,
      url: pageUrl(wiki, a.name), pageKey: `${wiki}:${a.id}`, entryType: 'article', status: i % 9 === 4 ? 'pending' : 'validated',
      metadata: JSON.stringify(articleMeta(wiki, a, pageUrl, new Date(submittedAt.getTime() - 3600000).toISOString())),
      validation: JSON.stringify({ errors: [], warnings: [] }), checkedAt: submittedAt, submittedAt,
    };
  });
  await prisma.submission.createMany({ data: rows });
  return bn.articles.length + rows.length;
}

// Real article titles for tracked edits.
const realTitles = () => FOUNTAIN.editathons.flatMap((e) => e.articles.map((a) => ({ wiki: WIKI[e.wiki], title: a.name, user: a.user })));

module.exports = { seedFountain, realTitles, FOUNTAIN };
