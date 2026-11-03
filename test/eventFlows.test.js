const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { NAME, LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');
const { createMockWikimedia } = require('./helpers/mockWikimedia');

const mock = createMockWikimedia({
  consumerKey: 'k',
  consumerSecret: 's',
  user: { wikimediaId: 5001, username: 'Remote Juror', homeWiki: 'enwiki', registration: '2012-01-01T00:00:00Z', editCount: 777 },
});
let t;
let ids;

before(async () => {
  const baseUrl = await mock.start();
  t = await startTestApp({ DEMO_MODE: 'true', WIKIMEDIA_OAUTH_BASE_URL: baseUrl });
  await require('../prisma/seed').seedDemoData(t.prisma);
  const contests = await t.prisma.contest.findMany();
  const users = await t.prisma.user.findMany();
  ids = {
    contest: Object.fromEntries(contests.map((c) => [c.slug, c.id])),
    user: Object.fromEntries(users.map((u) => [(LABEL[u.username] || u.username), u.id])),
  };
});

after(async () => {
  await t?.stop();
  await mock.stop();
});

async function session(name) {
  const page = await t.request('/demo');
  const res = await t.request('/demo/login', { cookie: page.cookie, method: 'POST', form: { _csrf: csrfFrom(page.body), userId: ids.user[name] } });
  const cookie = res.cookie;
  const csrf = csrfFrom((await t.request('/dashboard', { cookie })).body);
  return {
    get: (path) => t.request(path, { cookie }),
    post: (path, form = {}) => t.request(path, { cookie, method: 'POST', form: { _csrf: csrf, ...form } }),
    // Follows one redirect and returns the flash text shown there.
    async flashAfter(path, form) {
      const res = await this.post(path, form);
      assert.equal(res.status, 302, `${path} should redirect, got ${res.status}`);
      const page = await t.request(res.location, { cookie });
      const alert = (page.body.match(/class="alert alert-\w+[^"]*" role="(?:status|alert)">([\s\S]*?)<\/div>/) || [])[1] || '';
      return { res, text: alert.replace(/<[^>]+>/g, '').trim() };
    },
  };
}

const eventBody = (overrides = {}) => ({
  type: 'photo',
  title: 'Test Photo Contest',
  primaryWiki: 'commonswiki',
  timezone: 'UTC',
  language: 'en',
  visibility: 'public',
  startDate: '2026-01-01T00:00',
  endDate: '2030-12-31T00:00',
  minAccountAgeDays: '0',
  minEditCount: '0',
  registrationEnabled: 'on',
  juryReviewEnabled: 'on',
  type_minResolutionMegapixels: '2',
  type_maxEntriesPerParticipant: '0',
  ...overrides,
});

test('only people with createEvent can open the create pages', async () => {
  const newcomer = await session('Newcomer');
  assert.equal((await newcomer.get('/events/create')).status, 403);
  assert.equal((await newcomer.post('/events/create', eventBody())).status, 403);

  const organizer = await session('Organizer');
  assert.match((await organizer.get('/events/create')).body, /step 1 of 2/i);
  assert.match((await organizer.get('/events/create?type=data')).body, /Required properties/);
});

test('local admins can only create events on their own wiki', async () => {
  const bnAdmin = await session('Bn Admin');
  const denied = await bnAdmin.post('/events/create', eventBody({ title: 'Commons attempt' }));
  assert.equal(denied.status, 422);
  assert.match(denied.body, /can&#39;t use this wiki/);

  const ok = await bnAdmin.post('/events/create', eventBody({ title: 'Bangla Writing Sprint', type: 'writing', primaryWiki: 'bnwiki' }));
  assert.equal(ok.status, 302);
  const created = await t.prisma.contest.findUnique({ where: { slug: 'bangla-writing-sprint' }, include: { settings: true, memberships: true } });
  assert.equal(created.status, 'draft');
  assert.equal(created.isDemo, true, 'events made by demo users are cleaned up by re-seeding');
  assert.equal(created.createdById, ids.user['Bn Admin']);
  assert.deepEqual(created.memberships.map((m) => m.role), ['organizer']);
  assert.equal(JSON.parse(created.settings.typeConfig).minWordCount, 300);
});

test('create, publish, edit, pin status and audit an event', async () => {
  const organizer = await session('Organizer');
  const created = await organizer.post('/events/create', eventBody({ title: 'Lifecycle Test', slug: 'lifecycle-test', type_awardCategories: 'Best\nRunner-up' }));
  assert.equal(created.status, 302);
  const id = Number(created.location.match(/\/contest\/(\d+)\/config/)[1]);
  const path = `/contest/${id}`;

  assert.equal((await t.request(path)).status, 404, 'drafts are hidden from the public');
  const dup = await organizer.post('/events/create', eventBody({ title: 'Other', slug: 'lifecycle-test' }));
  assert.equal(dup.status, 422, 'explicit slugs must be unique');

  let r = await organizer.flashAfter(`${path}/status`, { action: 'publish' });
  assert.match(r.text, /status updated/);
  let row = await t.prisma.contest.findUnique({ where: { id } });
  assert.equal(row.status, 'active');
  assert.equal((await t.request(path)).status, 200, 'published events are public');

  const edit = await organizer.post(`${path}/config`, eventBody({ title: 'Lifecycle Test Renamed', slug: 'lifecycle-test', startDate: '2029-01-01T00:00', timezone: 'Asia/Dhaka' }));
  assert.equal(edit.status, 302);
  row = await t.prisma.contest.findUnique({ where: { id } });
  assert.equal(row.title, 'Lifecycle Test Renamed');
  assert.equal(row.startDate.toISOString(), '2028-12-31T18:00:00.000Z', 'dates use the event timezone');
  assert.equal(row.status, 'upcoming', 'auto status follows edited dates');

  const bad = await organizer.post(`${path}/config`, eventBody({ title: '', endDate: '2020-01-01T00:00' }));
  assert.equal(bad.status, 422);
  assert.match(bad.body, /highlighted field/);

  r = await organizer.flashAfter(`${path}/status`, { action: 'set_status', status: 'under_review' });
  row = await t.prisma.contest.findUnique({ where: { id } });
  assert.deepEqual([row.status, row.statusMode], ['under_review', 'manual']);
  r = await organizer.flashAfter(`${path}/status`, { action: 'archive' });
  assert.match(r.text, /Only completed or cancelled/);
  await organizer.flashAfter(`${path}/status`, { action: 'resume_auto' });
  row = await t.prisma.contest.findUnique({ where: { id } });
  assert.deepEqual([row.status, row.statusMode], ['upcoming', 'auto']);

  const actions = (await t.prisma.auditLog.findMany({ where: { contestId: id } })).map((l) => l.action);
  for (const a of ['contest.created', 'contest.statusChanged', 'contest.updated']) assert.ok(actions.includes(a), a);
  const activity = await organizer.get(`${path}/activity`);
  assert.match(activity.body, /created the event/);
  assert.equal((await (await session('Participant')).get(`${path}/activity`)).status, 403, 'activity is for managers only');
});

test('the status sweep moves auto events along and leaves pinned ones alone', async () => {
  const { refreshStatuses } = require('../src/services/lifecycleService');
  const past = { startDate: new Date('2020-01-01'), endDate: new Date('2020-02-01'), type: 'editathon', primaryWiki: 'bnwiki', settings: { create: { juryReviewEnabled: false } } };
  const auto = await t.prisma.contest.create({ data: { ...past, slug: 'sweep-auto', title: 'Sweep auto', status: 'active' } });
  const pinned = await t.prisma.contest.create({ data: { ...past, slug: 'sweep-pinned', title: 'Sweep pinned', status: 'active', statusMode: 'manual' } });
  assert.ok((await refreshStatuses()) >= 1);
  assert.equal((await t.prisma.contest.findUnique({ where: { id: auto.id } })).status, 'completed');
  assert.equal((await t.prisma.contest.findUnique({ where: { id: pinned.id } })).status, 'active');
  assert.ok(await t.prisma.auditLog.findFirst({ where: { contestId: auto.id, action: 'contest.statusChanged' } }));
});

test('members: add by Wikimedia lookup, role permissions, conflicts, last organizer', async () => {
  const wlm = `/contest/${ids.contest['demo-wlm-bangladesh-2026']}`;
  const organizer = await session('Organizer');

  // MediaWiki normalization: underscores become spaces and only the first letter is case-insensitive.
  let r = await organizer.flashAfter(`${wlm}/members`, { username: 'remote_Juror', role: 'jury' });
  assert.match(r.text, /Remote Juror added as jury/);
  const imported = await t.prisma.user.findUnique({ where: { username: 'Remote Juror' } });
  assert.deepEqual([imported.wikimediaId, imported.globalEditCount, imported.homeWiki], [5001, 777, 'enwiki']);

  r = await organizer.flashAfter(`${wlm}/members`, { username: 'Remote Juror', role: 'participant' });
  assert.match(r.text, /Jury members may not participate/);
  r = await organizer.flashAfter(`${wlm}/members`, { username: 'Nobody Here', role: 'jury' });
  assert.match(r.text, /No Wikimedia user named/);

  const organizerMembership = await t.prisma.contestMembership.findFirst({ where: { contestId: ids.contest['demo-wlm-bangladesh-2026'], role: 'organizer' } });
  r = await organizer.flashAfter(`${wlm}/members/${organizerMembership.id}/remove`);
  assert.match(r.text, /at least one organizer/);

  const juror = await session('Juror');
  assert.equal((await juror.post(`${wlm}/members`, { username: 'Remote Juror', role: 'viewer' })).status, 403);

  // A per-event override lets the juror manage the jury, and only the jury.
  r = await organizer.flashAfter(`${wlm}/overrides`, { username: NAME.Juror, permission: 'manageJury', allowed: 'true' });
  assert.match(r.text, /Override saved/);
  const jurorAgain = await session('Juror');
  const people = await jurorAgain.get(`${wlm}/participants`);
  assert.equal(people.status, 200);
  assert.doesNotMatch(people.body, /<option value="participant">/);
  r = await jurorAgain.flashAfter(`${wlm}/members`, { username: NAME.Newcomer, role: 'participant' });
  assert.match(r.text, /can't add people with that role|can&#39;t add/);
  const participantRow = await t.prisma.contestMembership.findFirst({ where: { contestId: ids.contest['demo-wlm-bangladesh-2026'], role: 'participant', status: 'active' } });
  assert.equal((await jurorAgain.post(`${wlm}/members/${participantRow.id}/remove`)).status, 403);
  assert.equal((await t.prisma.contestMembership.findUnique({ where: { id: participantRow.id } })).status, 'active', 'jury managers cannot remove participants');

  r = await organizer.flashAfter(`${wlm}/overrides`, { username: NAME.Juror, permission: 'accessAdmin', allowed: 'true' });
  assert.match(r.text, /cannot be changed per event/);
});

test('join and leave follow the eligibility rules', async () => {
  const whm = `/contest/${ids.contest['demo-bnwiki-womens-history-2027']}`;
  const participant = await session('Participant');
  assert.match((await participant.get(whm)).body, /Join this event/);
  let r = await participant.flashAfter(`${whm}/join`);
  assert.match(r.text, /joined/);
  assert.ok(await t.prisma.contestMembership.findFirst({ where: { contestId: ids.contest['demo-bnwiki-womens-history-2027'], userId: ids.user.Participant, role: 'participant', status: 'active' } }));
  r = await participant.flashAfter(`${whm}/leave`);
  assert.match(r.text, /left/);

  const newcomer = await session('Newcomer');
  const page = await newcomer.get(whm);
  assert.match(page.body, /at least 100 edits/);
  assert.doesNotMatch(page.body, /Join this event/);
  r = await newcomer.flashAfter(`${whm}/join`);
  assert.match(r.text, /at least 100 edits/);

  assert.equal((await t.request(`${whm}/join`, { method: 'POST' })).status, 403, 'anonymous POST is rejected by CSRF');
});

test('soft delete needs the slug, hides the event everywhere and is audited', async () => {
  const food = ids.contest['demo-wiki-loves-food-2027'];
  const organizer = await session('Organizer');
  assert.equal((await organizer.post(`/contest/${food}/delete`, { confirmation: 'demo-wiki-loves-food-2027' })).status, 403, 'organizer of other events only');

  const bnAdmin = await session('Bn Admin');
  let r = await bnAdmin.flashAfter(`/contest/${food}/delete`, { confirmation: 'wrong' });
  assert.match(r.text, /Type the event slug/);
  r = await bnAdmin.flashAfter(`/contest/${food}/delete`, { confirmation: 'demo-wiki-loves-food-2027' });
  assert.match(r.text, /was deleted/);

  const row = await t.prisma.contest.findUnique({ where: { id: food } });
  assert.ok(row.deletedAt, 'row is kept');
  assert.equal(row.deletedById, ids.user['Bn Admin']);
  assert.equal((await bnAdmin.get(`/contest/${food}`)).status, 404);
  assert.doesNotMatch((await t.request('/events')).body, /Wiki Loves Food/);
  assert.doesNotMatch((await bnAdmin.get('/dashboard')).body, /Wiki Loves Food/);
  assert.ok(await t.prisma.auditLog.findFirst({ where: { contestId: food, action: 'contest.deleted' } }));
});

test('listings support search and sorting', async () => {
  const res = await t.request('/events?q=Liberation');
  assert.match(res.body, /Liberation War Archives/);
  assert.doesNotMatch(res.body, /Wiki Loves Monuments/);
  const sorted = await t.request('/events?sort=title');
  assert.ok(sorted.body.indexOf('Bangla Wikipedia') < sorted.body.indexOf('Wikidata Bangladesh'));
});
