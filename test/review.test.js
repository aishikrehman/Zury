const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');

let t;
let ids;

before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  await require('../prisma/seed').seedDemoData(t.prisma);
  const users = await t.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [LABEL[u.username] || u.username, u.id]));
});
after(() => t?.stop());

async function session(label) {
  const page = await t.request('/demo');
  const res = await t.request('/demo/login', { cookie: page.cookie, method: 'POST', form: { _csrf: csrfFrom(page.body), userId: ids[label] } });
  const cookie = res.cookie;
  const csrf = csrfFrom((await t.request('/dashboard', { cookie })).body);
  return {
    get: (path) => t.request(path, { cookie }),
    post: (path, form = {}) => t.request(path, { cookie, method: 'POST', form: { _csrf: csrf, ...form } }),
  };
}

const wam = () => t.prisma.contest.findUnique({ where: { slug: 'wam-2026' }, include: { settings: true } });

test('a wiki jury reviews only its own wiki, one entry at a time', async () => {
  const bn = await session('Bn Admin');
  const page = await bn.get('/wam/2026/review');
  assert.equal(page.status, 200);
  const id = Number(page.body.match(/action="\/wam\/2026\/review\/(\d+)"/)[1]);
  const entry = await t.prisma.submission.findUnique({ where: { id } });
  assert.equal(entry.wiki, 'bnwiki', 'bn jury gets bnwiki entries');

  // An English entry is not theirs to judge.
  const en = await t.prisma.submission.findFirst({ where: { contestId: entry.contestId, wiki: 'enwiki', status: 'validated' } });
  assert.equal((await bn.get(`/wam/2026/review?entry=${en.id}`)).status, 404);
  assert.equal((await bn.post(`/wam/2026/review/${en.id}`, { decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '2' })).status, 404);

  // Marks are required.
  const missing = await bn.post(`/wam/2026/review/${id}`, { decision: 'accept', 'mark:Accepted': 'Yes' });
  assert.equal(missing.status, 302);
  assert.equal((await t.prisma.review.count({ where: { submissionId: id } })), 0);

  const saved = await bn.post(`/wam/2026/review/${id}`, { decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '3', comment: 'Well sourced.' });
  assert.equal(saved.status, 302);
  assert.match(saved.location, new RegExp(`/wam/2026/review\\?after=${id}`));
  const after = await t.prisma.submission.findUnique({ where: { id } });
  assert.equal(after.status, 'approved', 'one review decides when one is needed');
  assert.equal(after.score, 4);
});

test('with two reviews needed, the majority decides and the score is the average', async () => {
  const c = await wam();
  await t.prisma.contestSettings.update({ where: { contestId: c.id }, data: { requiredReviews: 2 } });
  // An event-wide juror and the bn jury both review the same bn entry.
  await t.prisma.contestMembership.create({ data: { contestId: c.id, userId: ids.Steward, role: 'jury', wiki: '' } });
  const entry = await t.prisma.submission.findFirst({ where: { contestId: c.id, wiki: 'bnwiki', status: 'validated' }, orderBy: { id: 'desc' } });

  const bn = await session('Bn Admin');
  await bn.post(`/wam/2026/review/${entry.id}`, { decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '3' });
  assert.equal((await t.prisma.submission.findUnique({ where: { id: entry.id } })).status, 'under_review');

  const steward = await session('Steward');
  await steward.post(`/wam/2026/review/${entry.id}`, { decision: 'reject', 'mark:Accepted': 'No', 'mark:Quality': '0' });
  const decided = await t.prisma.submission.findUnique({ where: { id: entry.id } });
  assert.equal(decided.status, 'rejected', 'a tie is not a majority');
  assert.equal(decided.score, 2, 'average of 4 and 0');
  await t.prisma.contestSettings.update({ where: { contestId: c.id }, data: { requiredReviews: 1 } });
});

test('participants cannot review; the jury queue lists their events', async () => {
  const participant = await session('Participant');
  assert.equal((await participant.get('/wam/2026/review')).status, 403);
  const juror = await session('Juror');
  const queue = await juror.get('/review');
  assert.equal(queue.status, 200);
  assert.match(queue.body, /Wikipedia Asian Month 2026/);
  assert.match(queue.body, /href="\/wam\/2026\/review"/);
});

test('results are private until published, then public', async () => {
  assert.equal((await t.request('/wam/2026/results')).status, 403);
  const organizer = await session('Organizer');
  const page = await organizer.get('/wam/2026/results');
  assert.equal(page.status, 200);
  assert.match(page.body, /Leaderboard/);
  await organizer.post('/wam/2026/results/publish', { published: '1' });
  assert.equal((await t.request('/wam/2026/results')).status, 200);
  assert.ok((await wam()).resultsPublishedAt);

  const { leaderboard } = require('../src/services/reviewService');
  const c = await wam();
  const rows = await leaderboard({ contest: c, settings: c.settings });
  assert.ok(rows.length > 0);
  assert.equal(rows[0].rank, 1);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].points >= r.points), 'sorted by points');
});

test('appeals: a participant appeals a rejection, an organizer upholds it and the jury sees it again', async () => {
  const c = await t.prisma.contest.findUnique({ where: { slug: 'wlm-bangladesh-2026' } });
  await t.prisma.contest.update({ where: { id: c.id }, data: { appealDeadline: new Date(Date.now() + 86400000) } });
  const entry = await t.prisma.submission.findFirst({ where: { contestId: c.id, participantId: ids.Participant, status: 'rejected' } });
  const participant = await session('Participant');
  const sent = await participant.post(`/wlm/2026/submissions/${entry.id}/appeal`, { reason: 'It is a listed monument; please look again.' });
  assert.equal(sent.status, 302);
  assert.equal((await t.prisma.submission.findUnique({ where: { id: entry.id } })).status, 'appealed');
  const appeal = await t.prisma.appeal.findFirst({ where: { submissionId: entry.id, status: 'open' } });

  assert.equal((await participant.post(`/wlm/2026/appeals/${appeal.id}/uphold`)).status, 403);
  const organizer = await session('Organizer');
  assert.match((await organizer.get('/wlm/2026/appeals')).body, /please look again/);
  await organizer.post(`/wlm/2026/appeals/${appeal.id}/uphold`, { response: 'Agreed.' });
  assert.equal((await t.prisma.appeal.findUnique({ where: { id: appeal.id } })).status, 'upheld');
  assert.equal((await t.prisma.submission.findUnique({ where: { id: entry.id } })).status, 'under_review', 'back to the jury');
});

test('assignments: entries are shared out evenly and jury members see only theirs', async () => {
  const c = await wam();
  await t.prisma.contestSettings.update({ where: { contestId: c.id }, data: { reviewAssignment: 'assigned', requiredReviews: 1 } });
  // A second event-wide jury member so the load has to be split.
  await t.prisma.contestMembership.upsert({
    where: { contestId_userId_role_wiki: { contestId: c.id, userId: ids['Platform Admin'], role: 'jury', wiki: '' } },
    update: { status: 'active' },
    create: { contestId: c.id, userId: ids['Platform Admin'], role: 'jury', wiki: '' },
  });

  const participant = await session('Participant');
  assert.equal((await participant.get('/wam/2026/assignments')).status, 403);

  const organizer = await session('Organizer');
  const page = await organizer.get('/wam/2026/assignments');
  assert.equal(page.status, 200);
  assert.match(page.body, /Entries waiting for the jury/);
  const res = await organizer.post('/wam/2026/assignments/distribute');
  assert.equal(res.status, 302);

  const waiting = await t.prisma.submission.findMany({ where: { contestId: c.id, status: { in: ['pending', 'validated', 'under_review'] } }, include: { assignments: true } });
  assert.ok(waiting.length > 0);
  for (const e of waiting) {
    assert.ok(e.assignments.length >= 1, `entry ${e.id} has a jury member`);
    assert.ok(e.assignments.every((a) => a.jurorId !== e.participantId), 'nobody gets their own entry');
  }
  // Everyone eligible for an English entry: the en jury, the steward and the platform admin; the load is spread.
  const loads = await t.prisma.reviewAssignment.groupBy({ by: ['jurorId'], where: { contestId: c.id }, _count: { _all: true } });
  assert.ok(loads.length >= 2, 'more than one jury member got work');
  const counts = loads.map((l) => l._count._all);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= Math.ceil(waiting.length / 2), 'roughly even');

  // A jury member's window only offers their assigned entries; others are refused.
  const mine = await t.prisma.reviewAssignment.findFirst({ where: { contestId: c.id, jurorId: ids['Platform Admin'] } });
  const notMine = await t.prisma.submission.findFirst({ where: { contestId: c.id, status: 'validated', assignments: { none: { jurorId: ids['Platform Admin'] } } } });
  const admin = await session('Platform Admin');
  const win = await admin.get('/wam/2026/review');
  const offered = Number(win.body.match(/action="\/wam\/2026\/review\/(\d+)"/)[1]);
  assert.ok(await t.prisma.reviewAssignment.findFirst({ where: { submissionId: offered, jurorId: ids['Platform Admin'] } }), 'the window offers an assigned entry');
  const refused = await admin.post(`/wam/2026/review/${notMine.id}`, { decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '1' });
  assert.equal(refused.status, 302);
  assert.equal(await t.prisma.review.count({ where: { submissionId: notMine.id, jurorId: ids['Platform Admin'] } }), 0);

  // Removing one and taking back the rest.
  await organizer.post(`/wam/2026/assignments/${mine.id}/remove`);
  assert.equal(await t.prisma.reviewAssignment.count({ where: { id: mine.id } }), 0);
  await organizer.post(`/wam/2026/assignments/release/${ids['Platform Admin']}`);
  assert.equal(await t.prisma.reviewAssignment.count({ where: { contestId: c.id, jurorId: ids['Platform Admin'] } }), 0);

  // Assigning by hand: only jury members of the entry's wiki.
  const entry = await t.prisma.submission.findFirst({ where: { contestId: c.id, status: 'validated', wiki: 'bnwiki' } });
  await organizer.post('/wam/2026/assignments/add', { submissionId: String(entry.id), jurorId: String(ids.Juror) });
  assert.equal(await t.prisma.reviewAssignment.count({ where: { submissionId: entry.id, jurorId: ids.Juror } }), 0, 'the en jury cannot take a bn entry');
  await organizer.post('/wam/2026/assignments/add', { submissionId: String(entry.id), jurorId: String(ids['Platform Admin']) });
  assert.equal(await t.prisma.reviewAssignment.count({ where: { submissionId: entry.id, jurorId: ids['Platform Admin'] } }), 1);
  await t.prisma.contestSettings.update({ where: { contestId: c.id }, data: { reviewAssignment: 'open' } });
});
