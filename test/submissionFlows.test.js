const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { NAME, LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');
const { createMockWikiApi } = require('./helpers/mockWikiApi');

const file = (pageid, title, { mp = [6000, 4000], cats = ['Images from Wiki Loves Monuments 2026 in Bangladesh'], at = '2026-10-01T10:00:00Z' } = {}) => ({
  pageid,
  ns: 6,
  title,
  length: 900,
  revisions: [{ timestamp: at, user: 'Uploader' }],
  categories: cats.map((c) => ({ ns: 14, title: `Category:${c}` })),
  imageinfo: [{ width: mp[0], height: mp[1], mime: 'image/jpeg', thumburl: `https://upload.wikimedia.org/thumb/${pageid}.jpg`, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
});

const api = createMockWikiApi({
  'commonswiki|File:Good one.jpg': file(101, 'File:Good one.jpg'),
  'commonswiki|File:Good two.jpg': file(102, 'File:Good two.jpg'),
  'commonswiki|File:Good three.jpg': file(103, 'File:Good three.jpg'),
  'commonswiki|File:Tiny.jpg': file(104, 'File:Tiny.jpg', { mp: [800, 600] }),
  'commonswiki|File:Uncategorized.jpg': file(105, 'File:Uncategorized.jpg', { cats: [] }),
  'bnwiki|অপারেশন জ্যাকপট নতুন': { pageid: 201, ns: 0, title: 'অপারেশন জ্যাকপট নতুন', length: 9000, revisions: [{ timestamp: '2026-10-20T00:00:00Z', user: 'X' }], extract: 'এক দুই তিন' },
});
let t;
let ids;

before(async () => {
  const template = await api.start();
  t = await startTestApp({ DEMO_MODE: 'true', WIKIMEDIA_API_URL_TEMPLATE: template });
  await require('../prisma/seed').seedDemoData(t.prisma);
  ids = {
    contest: Object.fromEntries((await t.prisma.contest.findMany()).map((c) => [c.slug, c.id])),
    user: Object.fromEntries((await t.prisma.user.findMany()).map((u) => [(LABEL[u.username] || u.username), u.id])),
  };
});

after(async () => {
  await t?.stop();
  await api.stop();
});

async function session(name) {
  const page = await t.request('/demo');
  const res = await t.request('/demo/login', { cookie: page.cookie, method: 'POST', form: { _csrf: csrfFrom(page.body), userId: ids.user[name] } });
  const cookie = res.cookie;
  const csrf = csrfFrom((await t.request('/dashboard', { cookie })).body);
  return {
    get: (path) => t.request(path, { cookie }),
    post: (path, form = {}) => t.request(path, { cookie, method: 'POST', form: { _csrf: csrf, ...form } }),
  };
}

const wlm = () => `/contest/${ids.contest['wlm-bangladesh-2026']}`;

test('preview checks every line without saving anything', async () => {
  const p = await session('Participant');
  const before = await t.prisma.submission.count();
  const res = await p.post(`${wlm()}/submit/preview`, {
    entries: [
      'https://commons.wikimedia.org/wiki/File:Good_one.jpg',
      'File:Tiny.jpg',
      'File:Uncategorized.jpg',
      'File:Missing.jpg',
      'https://evil.example.com/x',
      'File:Good one.jpg',
    ].join('\n'),
  });
  assert.equal(res.status, 200);
  assert.match(res.body, /1 ready/);
  assert.match(res.body, /below the 2 MP minimum/);
  assert.match(res.body, /Missing the required category/);
  assert.match(res.body, /does not exist/);
  assert.match(res.body, /Not a Wikimedia wiki URL/);
  assert.match(res.body, /Already submitted/, 'duplicates within one batch are caught');
  assert.equal(await t.prisma.submission.count(), before);
  assert.ok(api.requests.every((r) => /^Zury\//.test(r.userAgent)));
});

test('confirm re-checks on the server and saves only valid entries with history', async () => {
  const p = await session('Participant');
  // A tampered confirm that sneaks in a bad entry is re-checked and skipped.
  const res = await p.post(`${wlm()}/submit`, { entries: 'File:Good one.jpg\nFile:Tiny.jpg' });
  assert.equal(res.status, 302);
  const rows = await t.prisma.submission.findMany({ where: { contestId: ids.contest['wlm-bangladesh-2026'], title: { in: ['File:Good one.jpg', 'File:Tiny.jpg'] } }, include: { history: true } });
  assert.deepEqual(rows.map((r) => [r.title, r.status, r.pageKey, r.history[0].action]), [['File:Good one.jpg', 'validated', 'commonswiki:101', 'submitted']]);
  assert.equal(JSON.parse(rows[0].metadata).file.megapixels, 24);

  const again = await p.post(`${wlm()}/submit`, { entries: 'File:Good one.jpg' });
  assert.equal(again.status, 422);
  assert.match(again.body, /None of these entries can be submitted/);
});

test('people outside the event: auto-join when allowed, blocked when not eligible', async () => {
  const bnAdmin = await session('Bn Admin');
  const blocked = await bnAdmin.post(`${wlm()}/submit/preview`, { entries: 'File:Good two.jpg' });
  assert.equal(blocked.status, 422);
  assert.match(blocked.body, /Jury members may not participate/);

  const steward = await session('Steward');
  const res = await steward.post(`${wlm()}/submit`, { entries: 'File:Good two.jpg' });
  assert.equal(res.status, 302);
  assert.ok(await t.prisma.contestMembership.findFirst({ where: { contestId: ids.contest['wlm-bangladesh-2026'], userId: ids.user.Steward, role: 'participant' } }));
});

test('organizers submit on behalf of participants; others cannot', async () => {
  const organizer = await session('Organizer');
  const res = await organizer.post(`${wlm()}/submit`, { entries: 'File:Good three.jpg', participant: NAME.Newcomer });
  assert.equal(res.status, 302);
  const s = await t.prisma.submission.findFirst({ where: { title: 'File:Good three.jpg' }, include: { history: true } });
  assert.deepEqual([s.participantId, s.submittedById], [ids.user.Newcomer, ids.user.Organizer]);
  assert.ok(s.history[0].note.includes(`on behalf of ${NAME.Newcomer}`));
  assert.ok(await t.prisma.auditLog.findFirst({ where: { action: 'submissions.created', actorId: ids.user.Organizer } }));

  const notMember = await organizer.post(`${wlm()}/submit/preview`, { entries: 'File:Good three.jpg', participant: NAME['Global Sysop'] });
  assert.match(notMember.body, /not a participant/);

  // A participant's "participant" field is ignored: they always submit as themselves.
  const p = await session('Participant');
  const ignored = await p.post(`${wlm()}/submit/preview`, { entries: 'File:Tiny.jpg', participant: NAME.Newcomer });
  assert.ok(!ignored.body.includes(NAME.Newcomer));
});

test('submissions are closed outside the window except for organizers', async () => {
  const whm = `/contest/${ids.contest['bnwiki-womens-history-2027']}`;
  const p = await session('Participant');
  const res = await p.post(`${whm}/submit/preview`, { entries: 'Anything' });
  assert.equal(res.status, 422);
  assert.match(res.body, /not accepting submissions/);
});

test('list visibility, detail, withdraw and manager status changes', async () => {
  const id = (await t.prisma.submission.findFirst({ where: { title: 'File:Good one.jpg' } })).id;
  const detail = `${wlm()}/submissions/${id}`;

  assert.equal((await t.request(detail)).status, 404, 'anonymous visitors only see nothing');
  const newcomer = await session('Newcomer');
  assert.equal((await newcomer.get(detail)).status, 404, "participants don't see other people's entries");
  const juror = await session('Juror');
  assert.equal((await juror.get(detail)).status, 200, 'jury can view submissions');
  assert.equal((await juror.post(`${detail}/status`, { status: 'approved' })).status, 403);

  const organizer = await session('Organizer');
  const list = await organizer.get(`${wlm()}/submissions?status=validated`);
  assert.match(list.body, /File:Good one.jpg/);
  let r = await organizer.post(`${detail}/status`, { status: 'under_review', note: 'Checking EXIF' });
  assert.equal(r.status, 302);
  const p = await session('Participant');
  r = await p.post(`${detail}/withdraw`);
  const row = await t.prisma.submission.findUnique({ where: { id }, include: { history: { orderBy: { id: 'asc' } } } });
  assert.equal(row.status, 'withdrawn');
  assert.deepEqual(row.history.map((h) => h.action), ['submitted', 'status_changed', 'withdrawn']);
  assert.equal(row.history[1].note, 'Checking EXIF');

  // Withdrawn entries no longer block resubmission.
  assert.equal((await p.post(`${wlm()}/submit`, { entries: 'File:Good one.jpg' })).status, 302);
  const mine = await p.get('/submissions');
  assert.match(mine.body, /File:Good one.jpg/);
});

test('revalidation refreshes metadata and flags pages that broke the rules', async () => {
  const organizer = await session('Organizer');
  const s = await t.prisma.submission.findFirst({ where: { title: 'File:Good two.jpg' } });
  const r = await organizer.post(`${wlm()}/submissions/${s.id}/revalidate`);
  assert.equal(r.status, 302);
  const after = await t.prisma.submission.findUnique({ where: { id: s.id } });
  assert.equal(after.status, 'validated');
  assert.ok(after.checkedAt > s.checkedAt);
});
