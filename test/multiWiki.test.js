const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');
const { computeContestScope, buildSubject } = require('../src/services/permissionService');
const { effectiveFor, buildOverrides } = require('../src/events/effective');

// --- Pure parts -------------------------------------------------------------

const contest = { id: 1, type: 'writing', primaryWiki: 'bnwiki', status: 'active', statusMode: 'auto', timezone: 'UTC' };
const active = (role, wiki = '') => ({ role, wiki, status: 'active' });

test('wiki-scoped roles apply only on their wiki; event-wide roles apply everywhere', () => {
  const subject = buildSubject({ globalRoles: [], wikiRoles: [] });
  const wikis = ['bnwiki', 'enwiki'];
  const jury = computeContestScope(subject, contest, [active('jury', 'bnwiki')], [], { wikis });
  assert.equal(jury.permissions.has('reviewEvent'), false, 'central view uses only event-wide rights');
  assert.equal(jury.forWiki('bnwiki').has('reviewEvent'), true);
  assert.equal(jury.forWiki('enwiki').has('reviewEvent'), false);
  assert.equal(jury.isGlobalController, false);
  assert.deepEqual(jury.wikisWith('reviewEvent'), ['bnwiki']);

  const organizer = computeContestScope(subject, contest, [active('organizer')], [], { wikis });
  assert.equal(organizer.isGlobalController, true);
  assert.equal(organizer.forWiki('enwiki').has('manageEvent'), true);
});

test('a local admin controls their wiki of an event but not the whole event', () => {
  const now = new Date();
  const subject = buildSubject({ globalRoles: [], wikiRoles: [{ wiki: 'bnwiki', rightName: 'sysop', verifiedAt: now, verificationSource: 'oauth' }] });
  const scope = computeContestScope(subject, contest, [], [], { wikis: ['bnwiki', 'enwiki'] });
  assert.equal(scope.forWiki('bnwiki').has('manageEvent'), true);
  assert.equal(scope.forWiki('enwiki').has('manageEvent'), false);
  assert.equal(scope.global.has('manageEvent'), false);
  // A single-wiki event treats its only wiki as the context.
  assert.equal(computeContestScope(subject, contest, [], [], { wikis: ['bnwiki'] }).permissions.has('manageEvent'), true);
});

test('effective settings merge wiki overrides over the event', () => {
  const settings = { minAccountAgeDays: 0, typeConfig: JSON.stringify({ minWordCount: 300 }) };
  const eventWiki = { wiki: 'enwiki', status: 'active', overrides: JSON.stringify({ settings: { minAccountAgeDays: 30 }, typeConfig: { minWordCount: 500, bogus: 1 }, contest: { timezone: 'Asia/Tokyo' } }) };
  const eff = effectiveFor(contest, settings, eventWiki);
  assert.equal(eff.settings.minAccountAgeDays, 30);
  assert.equal(eff.typeConfig.minWordCount, 500);
  assert.equal('bogus' in eff.typeConfig, false);
  assert.equal(eff.contest.timezone, 'Asia/Tokyo');
  assert.equal(eff.contest.primaryWiki, 'enwiki');
  assert.deepEqual([...eff.overridden].sort(), ['contest.timezone', 'settings.minAccountAgeDays', 'type.minWordCount']);

  const paused = effectiveFor(contest, settings, { ...eventWiki, status: 'paused' });
  assert.equal(paused.contest.status, 'paused');

  const built = buildOverrides({ contest: { timezone: 'UTC', title: 'x' }, settings: { minEditCount: 5 } }, { minWordCount: 1 }, ['contest.timezone', 'contest.title', 'settings.minEditCount', 'type.minWordCount']);
  assert.deepEqual(built, { contest: { timezone: 'UTC' }, settings: { minEditCount: 5 }, typeConfig: { minWordCount: 1 } });
});

// --- Pages ------------------------------------------------------------------

let t;
let ids;

before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  await require('../prisma/seed').seedDemoData(t.prisma);
  const users = await t.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [LABEL[u.username] || u.username, u.id]));
});

after(async () => {
  await t?.stop();
});

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

const wam = () => t.prisma.contest.findFirst({ where: { slug: 'wam-2026' }, include: { wikis: true } });

test('series, central dashboard and wiki pages share one address', async () => {
  const series = await t.request('/wam');
  assert.equal(series.status, 200);
  assert.match(series.body, /href="\/wam\/2026"/);

  const central = await t.request('/wam/2026');
  assert.equal(central.status, 200);
  for (const code of ['bn', 'hi', 'en']) assert.match(central.body, new RegExp(`href="/wam/2026/${code}"`));
  assert.doesNotMatch(central.body, /\/wam\/2026\/ta"/, 'pending wikis are hidden from the public');

  assert.equal((await t.request('/wam/2026/bn')).status, 200);
  assert.equal((await t.request('/wam/2026/ta')).status, 404);
  assert.equal((await t.request('/wam/2026/xx')).status, 404);
  assert.equal((await t.request('/nosuchseries/2026')).status, 404);
  assert.equal((await t.request('/events')).status, 200, 'app pages are never taken as a series');
});

test('wiki organizers manage only their wiki; global controllers manage the event', async () => {
  const bn = await session('Bn Admin');
  assert.equal((await bn.get('/wam/2026/bn/config')).status, 200);
  assert.equal((await bn.get('/wam/2026/en/config')).status, 403);
  assert.equal((await bn.get('/wam/2026/config')).status, 403);
  assert.equal((await bn.post('/wam/2026/bn/status', { action: 'cancel' })).status, 403, 'event status is event-wide');

  const organizer = await session('Organizer');
  const config = await organizer.get('/wam/2026/config');
  assert.equal(config.status, 200);
  assert.match(config.body, /id="wikis"/);
  assert.equal((await organizer.get('/wam/2026/ta')).status, 200, 'global controllers see pending wikis');
});

test('a wiki saves only the settings that differ from the event, and can reset them', async () => {
  const bn = await session('Bn Admin');
  const page = await bn.get('/wam/2026/bn/config');
  assert.match(page.body, /this wiki/);
  const res = await bn.post('/wam/2026/bn/config', {
    description: (await wam()).description,
    contactInfo: 'Bangla talk page',
    timezone: 'Asia/Dhaka',
    participationMode: 'individual',
    minAccountAgeDays: '0',
    minEditCount: '0',
    type_minWordCount: '400',
    type_minBytes: '3000',
    type_createdDuringEventOnly: 'on',
    registrationEnabled: 'on',
    autoValidationEnabled: 'on',
    juryReviewEnabled: 'on',
    publicStatisticsEnabled: 'on',
    participantNotificationsEnabled: 'on',
    badgesEnabled: 'on',
    startDate: '2026-11-01T06:00',
    endDate: '2026-12-01T05:59',
    registrationOpensAt: '2026-10-15T06:00',
    submissionOpensAt: '2026-11-01T06:00',
    submissionDeadline: '2026-12-01T05:59',
    reviewOpensAt: '2026-12-01T06:00',
    reviewDeadline: '2026-12-20T06:00',
  });
  assert.equal(res.status, 302);
  const row = (await wam()).wikis.find((w) => w.wiki === 'bnwiki');
  const saved = JSON.parse(row.overrides);
  assert.equal(saved.typeConfig.minWordCount, 400);
  assert.equal(saved.contest.contactInfo, 'Bangla talk page');
  assert.equal(saved.contest.timezone, 'Asia/Dhaka');
  assert.equal('startDate' in saved.contest, false, 'same instant as the event, so not an override');
  assert.equal('minBytes' in saved.typeConfig, false);

  await bn.post('/wam/2026/bn/config', { reset: '1' });
  const cleared = JSON.parse((await wam()).wikis.find((w) => w.wiki === 'bnwiki').overrides);
  assert.deepEqual(cleared, { contest: {}, settings: {}, typeConfig: {} });
});

test('anyone can ask to bring a wiki; approval makes them its organizer', async () => {
  const p = await session('Participant');
  const res = await p.post('/wam/2026/wikis/request', { wiki: 'mlwiki' });
  assert.equal(res.status, 302);
  let row = (await wam()).wikis.find((w) => w.wiki === 'mlwiki');
  assert.equal(row.status, 'pending');
  assert.equal((await p.post(`/wam/2026/wikis/${row.id}/approve`)).status, 403);

  const organizer = await session('Organizer');
  await organizer.post(`/wam/2026/wikis/${row.id}/approve`);
  row = (await wam()).wikis.find((w) => w.wiki === 'mlwiki');
  assert.equal(row.status, 'active');
  const role = await t.prisma.contestMembership.findFirst({ where: { contestId: row.contestId, userId: ids.Participant, role: 'organizer', wiki: 'mlwiki' } });
  assert.ok(role, 'requester becomes organizer of that wiki only');
  assert.equal((await p.get(`/wam/2026/${row.code}/config`)).status, 200);
  assert.equal((await p.get('/wam/2026/config')).status, 403);
});

test('wiki pages list only their own entries; staff can be added for one wiki', async () => {
  const organizer = await session('Organizer');
  const bnList = await organizer.get('/wam/2026/bn/submissions?q=%E0%A6%B8');
  assert.equal(bnList.status, 200);
  assert.match(bnList.body, /সিল্ক রোড/);
  assert.doesNotMatch(bnList.body, /Bagan temples/);
  assert.match((await organizer.get('/wam/2026/submissions?q=Bagan')).body, /Bagan temples/);
  await organizer.post('/wam/2026/members', { username: (await t.prisma.user.findUnique({ where: { id: ids['Platform Admin'] } })).username, role: 'jury', wiki: 'hiwiki' });
  const m = await t.prisma.contestMembership.findFirst({ where: { userId: ids['Platform Admin'], role: 'jury' } });
  assert.equal(m?.wiki, 'hiwiki');
});
