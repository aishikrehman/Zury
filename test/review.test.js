const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');

let t;
let ids;

before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  await require('./helpers/fixtures').seedDemoData(t.prisma);
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
  // Statistics are public here, so visitors see the page, but not the ranking.
  const before = await t.request('/wam/2026/results');
  assert.equal(before.status, 200);
  assert.doesNotMatch(before.body, /Leaderboard/);
  assert.match(before.body, /The ranking is published when the jury has finished/);
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
  // WAM counts by words: the ranking follows the words in accepted articles.
  assert.ok(c.settings.wordCountEnabled);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].words >= r.words), 'sorted by words');
  assert.ok(rows.some((r) => r.words > 0));
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

test('submissions table: sortable columns, wiki only on the whole event, quick actions return to the list', async () => {
  const organizer = await session('Organizer');
  const asc = await organizer.get('/wam/2026/submissions?sort=title&dir=asc');
  assert.equal(asc.status, 200);
  const titles = [...asc.body.matchAll(/<a href="\/wam\/2026\/submissions\/\d+">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.ok(titles.length > 1);
  assert.deepEqual(titles, [...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), 'sorted by title');
  assert.match(asc.body, /sort=title&amp;dir=desc/, 'a second click turns the order round');
  assert.match(asc.body, /page=2[^"]*sort=title|sort=title[^"]*page=2/, 'pages keep the order');
  assert.match(asc.body, /href="\?[^"]*participant=\d+/, 'a name filters the table to that participant');
  const pid = Number(asc.body.match(/participant=(\d+)/)[1]);
  const one = await organizer.get(`/wam/2026/submissions?participant=${pid}`);
  const owners = await t.prisma.submission.findMany({ where: { id: { in: [...one.body.matchAll(/\/wam\/2026\/submissions\/(\d+)"/g)].map((m) => Number(m[1])) } }, select: { participantId: true } });
  assert.ok(owners.length > 0 && owners.every((o) => o.participantId === pid), 'only that participant');
  assert.match(one.body, /words in all/, 'total words for what is shown');
  assert.match(asc.body, /z-entry-wiki/, 'several wikis: the wiki is shown');
  assert.doesNotMatch((await organizer.get("/wam/2026/bn/submissions")).body, /z-entry-wiki/, "one wiki: no wiki name");

  const c = await wam();
  const entry = await t.prisma.submission.findFirst({ where: { contestId: c.id, status: 'validated' } });
  const back = '/wam/2026/submissions?sort=title&dir=asc&page=2';
  const res = await organizer.post(`/wam/2026/submissions/${entry.id}/status`, { status: 'disqualified', back });
  assert.equal(res.location, back);
  assert.equal((await t.prisma.submission.findUnique({ where: { id: entry.id } })).status, 'disqualified');
  const outside = await organizer.post(`/wam/2026/submissions/${entry.id}/status`, { status: 'validated', back: 'https://example.org/' });
  assert.equal(outside.location, `/wam/2026/submissions/${entry.id}`, 'no leaving the event');
});

test('review links on the submissions page, bulk verdicts, and results with statistics', async () => {
  const bn = await session('Bn Admin');
  const list = await bn.get('/wam/2026/bn/submissions?status=validated');
  assert.match(list.body, /href="\/wam\/2026\/bn\/review\?entry=\d+"/, 'the gavel opens the review page');
  const ids = [...list.body.matchAll(/name="ids" value="(\d+)"/g)].map((m) => m[1]).slice(0, 2);
  assert.equal(ids.length, 2, 'rows can be picked for a bulk verdict');
  const c = await wam();
  const res = await bn.post('/wam/2026/bn/review/bulk', { ids, decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '2', back: '/wam/2026/bn/submissions?status=validated' });
  assert.equal(res.location, '/wam/2026/bn/submissions?status=validated');
  const reviewed = await t.prisma.review.count({ where: { contestId: c.id, submissionId: { in: ids.map(Number) }, jurorId: ids && (await t.prisma.user.findFirst({ where: { username: 'Tanvir Hossain' } })).id } });
  assert.equal(reviewed, 2);

  // An English entry is not the bn jury's to judge, even in bulk.
  const en = await t.prisma.submission.findFirst({ where: { contestId: c.id, wiki: 'enwiki', status: 'validated' } });
  await bn.post('/wam/2026/bn/review/bulk', { ids: [String(en.id)], decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '2' });
  assert.equal(await t.prisma.review.count({ where: { submissionId: en.id } }), 0);

  const organizer = await session('Organizer');
  const results = await organizer.get('/wam/2026/results');
  assert.match(results.body, /Results and statistics/);
  assert.match(results.body, /By wiki/, 'a multi-wiki event shows entries by wiki with the results');
  assert.doesNotMatch(results.body, /Top participants/, 'the leaderboard is the only ranking');
  assert.doesNotMatch((await organizer.get('/wam/2026')).body, /By wiki/, 'not on the overview');
  const people = await organizer.get('/wam/2026/participants');
  assert.match(people.body, /href="\/wam\/2026\/assignments"/, 'assignments sit under People');
});

test('series: every year at /wam, the next edition from the latest one, and new series', async () => {
  const page = await t.request('/wam');
  assert.equal(page.status, 200);
  assert.match(page.body, /Entries per edition|Edition/);
  assert.match(page.body, /href="\/wam\/2026"/);

  const participant = await session('Participant');
  assert.equal((await participant.post('/wam/next-edition')).status, 403, 'only organizers');

  const organizer = await session('Organizer');
  assert.match((await organizer.get('/wam')).body, /Create next edition/);
  const res = await organizer.post('/wam/next-edition');
  assert.equal(res.location, '/wam/2027/config');
  const next = await t.prisma.contest.findFirst({ where: { edition: '2027', series: { slug: 'wam' } }, include: { wikis: true, settings: true } });
  const last = await t.prisma.contest.findFirst({ where: { edition: '2026', series: { slug: 'wam' } }, include: { wikis: true, settings: true } });
  assert.equal(next.status, 'draft');
  assert.equal(next.title, 'Wikipedia Asian Month 2027');
  assert.equal(next.startDate.getUTCFullYear(), last.startDate.getUTCFullYear() + 1);
  assert.deepEqual(next.wikis.map((w) => w.wiki).sort(), last.wikis.map((w) => w.wiki).sort(), 'same wikis');
  assert.equal(next.settings.marks, last.settings.marks, 'same marks');
  assert.equal((await organizer.post('/wam/next-edition')).location, '/wam', 'not while the new one is a draft');
  await t.prisma.contest.delete({ where: { id: next.id } });

  const admin = await session('Steward');
  const made = await admin.post('/series', { slug: 'wlx', title: 'Wiki Loves X' });
  assert.equal(made.location, '/wlx');
  assert.equal((await admin.post('/series', { slug: 'wlx', title: 'Again' })).status, 400, 'address taken');
  await t.prisma.eventSeries.deleteMany({ where: { slug: 'wlx' } });
});

test('review page: filters, go to an entry, the next one after a verdict, and correcting your own', async () => {
  const bn = await session('Bn Admin');
  const c = await wam();
  const me = (await t.prisma.user.findFirst({ where: { username: 'Tanvir Hossain' } })).id;
  const someone = await t.prisma.submission.findFirst({ where: { contestId: c.id, wiki: 'bnwiki', status: 'validated', reviews: { none: { jurorId: me } }, NOT: { participantId: me } } });

  // Only this participant's entries come up.
  const onlyThem = await bn.get(`/wam/2026/bn/review?participant=${someone.participantId}`);
  const shown = Number(onlyThem.body.match(/action="\/wam\/2026\/bn\/review\/(\d+)"/)[1]);
  assert.equal((await t.prisma.submission.findUnique({ where: { id: shown } })).participantId, someone.participantId);
  assert.match(onlyThem.body, new RegExp(`name="filters" value="participant=${someone.participantId}"`), 'the filter rides along with the verdict');

  // Go to an entry by its number.
  const go = await bn.get(`/wam/2026/bn/review?go=%23${someone.id}`);
  assert.equal(go.location, `/wam/2026/bn/review?entry=${someone.id}`);

  // A verdict moves on, keeping the filter.
  const saved = await bn.post(`/wam/2026/bn/review/${someone.id}`, { decision: 'accept', 'mark:Accepted': 'Yes', 'mark:Quality': '1', filters: `participant=${someone.participantId}` });
  assert.equal(saved.location, `/wam/2026/bn/review?participant=${someone.participantId}&after=${someone.id}`);

  // "Reviewed by me" brings it back to correct it.
  const mine = await bn.get(`/wam/2026/bn/review?mode=mine&entry=${someone.id}`);
  assert.match(mine.body, /Your review/);
  await bn.post(`/wam/2026/bn/review/${someone.id}`, { decision: 'reject', 'mark:Accepted': 'No', 'mark:Quality': '0', filters: 'mode=mine' });
  assert.equal((await t.prisma.review.findFirst({ where: { submissionId: someone.id, jurorId: me } })).decision, 'reject');

  // Jury activity is on the page.
  assert.match(mine.body, /Jury activity/);
});

test('review queue order: the entry picker lists the queue in that order, a page at a time', async () => {
  const bn = await session('Bn Admin');
  const page = await bn.get('/wam/2026/bn/review?sort=words-desc&mode=open');
  assert.equal(page.status, 200);
  assert.match(page.body, /data-review-picker/, 'entries are picked from a searchable list');
  assert.doesNotMatch(page.body, /class="z-topbar/, 'the review page uses the whole screen');
  const res = await bn.get('/wam/2026/bn/review/entries?mode=open&sort=words-desc&page=1');
  const json = JSON.parse(res.body);
  assert.ok(json.items.length > 1);
  const words = json.items.map((i) => i.words ?? -1);
  assert.deepEqual(words, [...words].sort((x, y) => y - x), 'most words first');
  assert.equal(json.items[0].position, 1);
  const search = JSON.parse((await bn.get(`/wam/2026/bn/review/entries?mode=open&search=${encodeURIComponent(json.items[0].text.slice(0, 4))}`)).body);
  assert.ok(search.items.some((i) => i.value === json.items[0].value), 'searchable by title');
});

test('event data: download in CSV, Excel, wikitext and Markdown; clear the activity log', async () => {
  const organizer = await session('Organizer');
  const csv = await organizer.get('/wam/2026/export/entries.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.replace(/^\uFEFF/, '').startsWith('Title,Wiki,Participant,Status'), 'CSV with a header row');
  assert.match((await organizer.get('/wam/2026/export/results.xls')).body, /<Workbook/);
  assert.match((await organizer.get('/wam/2026/export/people.wiki')).body, /^\{\| class="wikitable sortable"/);
  assert.match((await organizer.get('/wam/2026/export/reviews.md')).body, /^# .*\n\n\| Entry \|/);
  assert.equal((await (await session('Participant')).get('/wam/2026/export/entries.csv')).status, 403, 'organizers only');

  const c = await wam();
  assert.ok(await t.prisma.auditLog.count({ where: { contestId: c.id } }));
  const config = await organizer.get('/wam/2026/config');
  assert.match(config.body, /id="data"/);
  await organizer.post('/wam/2026/data/clear/activity');
  assert.equal(await t.prisma.auditLog.count({ where: { contestId: c.id } }), 0, 'the event activity is gone');
  assert.ok(await t.prisma.auditLog.findFirst({ where: { action: 'eventData.cleared.activity' } }), 'but the clearing itself is recorded');
});

test('series management in three levels: all series, one series, one edition', async () => {
  const organizer = await session('Organizer');
  const all = await organizer.get('/series');
  assert.equal(all.status, 200);
  assert.match(all.body, /href="\/series\/wam"/, 'each series leads to its own page');
  const one = await organizer.get('/series/wam');
  assert.equal(one.status, 200);
  assert.match(one.body, /href="\/series\/wam\/2026"/, 'each edition leads to its own page');
  assert.match(one.body, /name="title"/, 'series details can be edited');
  const ed = await organizer.get('/series/wam/2026');
  assert.equal(ed.status, 200);
  assert.match(ed.body, /\/wam\/2026\/bn\/config/, 'each wiki has its own settings');
  assert.match(ed.body, /href="\/wam\/2026\/config"/);
  assert.equal((await (await session('Participant')).get('/series/wam')).status, 403);
  assert.equal((await organizer.get('/series/wam/1999')).status, 404);
});

test('visitors who are not logged in can open the submissions list', async () => {
  const r = await t.request('/wam/2026/submissions');
  assert.equal(r.status, 200);
});
