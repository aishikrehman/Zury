const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { LABEL, NAME } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');
// Loaded after the test app has set up its environment.
let wikiApi;
let realGet;
let t;
let ids;

before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  wikiApi = require('../src/wiki/wikiApi');
  realGet = wikiApi.get;
  await require('../prisma/seed').seedDemoData(t.prisma);
  const users = await t.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [LABEL[u.username] || u.username, u.id]));
});

afterEach(() => {
  wikiApi.get = realGet;
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
    async flash(path, form) {
      const res = await this.post(path, form);
      const page = await t.request(res.location, { cookie });
      return ((page.body.match(/class="alert alert-\w+[^"]*" role="(?:status|alert)">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    },
  };
}

const contest = (slug) => t.prisma.contest.findUnique({ where: { slug }, include: { settings: true, wikis: true } });
const eventPath = async (slug) => `/contest/${(await contest(slug)).id}`;

// --- Blocks and bans ----------------------------------------------------------

test('a blocked person cannot join, submit or be given a role until unblocked', async () => {
  const base = await eventPath('demo-liberation-war-editathon');
  const organizer = await session('Organizer');
  const text = await organizer.flash(`${base}/blocks`, { username: NAME.Newcomer, reason: 'Vandalism' });
  assert.match(text, /blocked from this event/);
  const c = await contest('demo-liberation-war-editathon');
  assert.equal(await t.prisma.contestMembership.count({ where: { contestId: c.id, userId: ids.Newcomer, status: 'active' } }), 0, 'roles end');

  const newcomer = await session('Newcomer');
  assert.match(await newcomer.flash(`${base}/join`), /blocked from this event/);
  const submit = await newcomer.post(`${base}/submit/preview`, { entries: 'কিছু' });
  assert.match(submit.body, /blocked from this event/);
  assert.match(await organizer.flash(`${base}/members`, { username: NAME.Newcomer, role: 'participant' }), /is blocked/);

  // Only event-wide authority may block.
  const participant = await session('Participant');
  assert.equal((await participant.post(`${base}/blocks`, { username: NAME.Juror })).status, 403);

  const block = await t.prisma.eventBlock.findFirst({ where: { contestId: c.id, userId: ids.Newcomer, liftedAt: null } });
  assert.match(await organizer.flash(`${base}/blocks/${block.id}/lift`), /lifted/);
  assert.match(await newcomer.flash(`${base}/join`), /joined/);
});

test('globally locked, globally blocked or locally blocked accounts are kept out', async () => {
  const { wikimediaBans } = require('../src/wiki/banCheck');
  const person = { username: 'Someone', isDemo: false };
  const answer = (over) => async (wiki, params) => {
    if (params.meta === 'globaluserinfo') return { query: { globaluserinfo: { name: 'Someone', ...(over.locked && { locked: true }) } } };
    if (params.list === 'globalblocks') return { query: { globalblocks: over.global ? [{ target: 'Someone' }] : [] } };
    if (params.list === 'blocks') return { query: { blocks: over.local ? [{ user: 'Someone', partial: over.partial || false }] : [] } };
    throw new Error('unexpected');
  };
  wikiApi.get = answer({});
  assert.deepEqual(await wikimediaBans(person, 'bnwiki'), []);
  wikiApi.get = answer({ locked: true });
  assert.match((await wikimediaBans(person, 'bnwiki')).join(), /globally locked/);
  wikiApi.get = answer({ global: true });
  assert.match((await wikimediaBans(person, 'bnwiki')).join(), /globally blocked/);
  wikiApi.get = answer({ local: true });
  assert.match((await wikimediaBans(person, 'bnwiki')).join(), /blocked on bnwiki/);
  wikiApi.get = answer({ local: true, partial: true });
  assert.deepEqual(await wikimediaBans(person, 'bnwiki'), [], 'partial blocks do not count');
  wikiApi.get = async () => {
    throw new Error('down');
  };
  assert.deepEqual(await wikimediaBans(person, 'bnwiki'), [], 'an unreachable wiki does not hold people up');
  assert.deepEqual(await wikimediaBans({ ...person, isDemo: true }, 'bnwiki'), []);
});

// --- Participants belong to a wiki ---------------------------------------------

test('participants choose their wiki and appear under that wiki', async () => {
  const newcomer = await session('Newcomer');
  await newcomer.post('/wam/2026/leave');
  // Someone whose home wiki isn't in the event has to pick one.
  assert.match(await (await session('Steward')).flash('/wam/2026/join', { wiki: '' }), /Choose the wiki/);
  assert.match(await newcomer.flash('/wam/2026/join', { wiki: '' }), /joined this event on bnwiki/, 'home wiki by default');
  await newcomer.post('/wam/2026/leave');
  assert.match(await newcomer.flash('/wam/2026/join', { wiki: 'hiwiki' }), /joined this event on hiwiki/);
  const m = await t.prisma.contestMembership.findFirst({ where: { userId: ids.Newcomer, role: 'participant', status: 'active', contest: { slug: 'demo-wam-2026' } } });
  assert.equal(m.wiki, 'hiwiki');
  // Joining from a wiki's page picks that wiki; there is still one participation.
  await newcomer.post('/wam/2026/leave');
  await newcomer.post('/wam/2026/en/join');
  const rows = await t.prisma.contestMembership.findMany({ where: { userId: ids.Newcomer, role: 'participant', status: 'active', contest: { slug: 'demo-wam-2026' } } });
  assert.deepEqual(rows.map((r) => r.wiki), ['enwiki']);

  const organizer = await session('Organizer');
  assert.match((await organizer.get('/wam/2026/en/participants')).body, new RegExp(NAME.Newcomer));
  assert.doesNotMatch((await organizer.get('/wam/2026/bn/participants')).body, new RegExp(`>${NAME.Newcomer}<`));
  // Still a participant of the whole event: may submit from the central page.
  const scope = await require('../src/services/permissionService').contestScope(
    { user: { id: ids.Newcomer }, platformRoles: new Set(), adminWikis: new Set() },
    await contest('demo-wam-2026'),
    { wikis: ['bnwiki', 'enwiki', 'hiwiki'] },
  );
  assert.equal(scope.permissions.has('submitOwnEntry'), true);
});

// --- Messages -------------------------------------------------------------------

test('organizers message their wiki through Wikimedia; demo accounts are told to log in', async () => {
  const { recipients } = require('../src/services/messageService');
  const c = await contest('demo-wam-2026');
  const bn = await recipients({ contestId: c.id, audience: 'participant', wiki: 'bnwiki' });
  const expected = await t.prisma.contestMembership.findMany({ where: { contestId: c.id, role: 'participant', status: 'active', wiki: 'bnwiki' }, include: { user: true } });
  assert.deepEqual(bn.map((u) => u.username), expected.map((m) => m.user.username).sort());
  assert.ok(bn.length > 0);
  const jury = await recipients({ contestId: c.id, audience: 'jury', wiki: 'bnwiki' });
  assert.deepEqual(jury.map((u) => u.username), [NAME['Bn Admin']]);

  const bnAdmin = await session('Bn Admin');
  const page = await bnAdmin.get('/wam/2026/bn/message');
  assert.equal(page.status, 200);
  assert.match(page.body, /Log out and log in with Wikimedia/);
  const res = await bnAdmin.post('/wam/2026/bn/message', { audience: 'participant', method: 'talk', subject: 'Hello', body: 'Welcome to WAM!', step: 'send' });
  assert.equal(res.status, 422);
  assert.match(res.body, /Log in with your Wikimedia account/);
  assert.equal((await (await session('Participant')).get('/wam/2026/message')).status, 403);
});

// --- Tracking -----------------------------------------------------------------

test('tracking finds participant edits, hashtag edits and category pages once each', async () => {
  const trackingService = require('../src/services/trackingService');
  const c = await contest('demo-old-dhaka-photowalk');
  await t.prisma.user.update({ where: { id: ids.Participant }, data: { isDemo: false } });
  await t.prisma.contestSettings.update({ where: { contestId: c.id }, data: { contributionDiscoveryEnabled: true, trackHashtags: '["olddhaka"]' } });
  const calls = [];
  wikiApi.get = async (wiki, p) => {
    calls.push(p.list);
    if (p.list === 'usercontribs') return { query: { usercontribs: [{ revid: 11, title: 'File:A.jpg', ns: 6, user: NAME.Participant, timestamp: '2026-11-01T05:00:00Z', sizediff: 900, new: true, comment: 'upload #olddhaka' }] } };
    if (p.list === 'recentchanges') {
      return { query: { recentchanges: [
        { revid: 11, title: 'File:A.jpg', ns: 6, user: NAME.Participant, timestamp: '2026-11-01T05:00:00Z', newlen: 900, oldlen: 0, type: 'new', comment: 'upload #olddhaka' },
        { revid: 12, title: 'File:B.jpg', ns: 6, user: 'Visitor', timestamp: '2026-11-01T06:00:00Z', newlen: 500, oldlen: 0, type: 'new', comment: 'From the #OldDhaka walk' },
        { revid: 13, title: 'File:C.jpg', ns: 6, user: 'Other', timestamp: '2026-11-01T07:00:00Z', newlen: 10, oldlen: 0, type: 'edit', comment: '#olddhakaX is a different tag' },
      ] } };
    }
    if (p.list === 'categorymembers') return { query: { categorymembers: [{ pageid: 501, title: 'File:D.jpg', ns: 6, timestamp: '2026-11-02T00:00:00Z' }] } };
    throw new Error(`unexpected ${p.list}`);
  };
  const settings = (await contest('demo-old-dhaka-photowalk')).settings;
  const first = await trackingService.refresh({ contest: c, settings, eventWikis: c.wikis, now: new Date('2026-11-03T00:00:00Z') });
  assert.equal(first.added, 3);
  assert.deepEqual(first.errors, []);
  const again = await trackingService.refresh({ contest: c, settings, eventWikis: c.wikis, now: new Date('2026-11-03T00:00:00Z') });
  assert.equal(again.added, 0, 'nothing is counted twice');

  await t.prisma.user.update({ where: { id: ids.Participant }, data: { isDemo: true } });
  const s = await trackingService.summary(c.id);
  assert.deepEqual(s.bySource, { participant: 1, hashtag: 1, category: 1 });
  assert.equal(s.newPages, 2);
  const page = await t.request(`/contest/${c.id}/tracking`);
  assert.equal(page.status, 200);
  assert.match(page.body, /File:B\.jpg/);
});

// --- Activities -------------------------------------------------------------------

test('sessions: registration, waiting list, attendance and certificate', async () => {
  const c = await contest('demo-wikipedia-basics-training');
  const base = `/contest/${c.id}`;
  assert.equal((await t.request(`${base}/submissions`)).status, 404, 'trainings take no entries');
  assert.equal((await t.request(`${base}/sessions`)).status, 200);
  const week3 = await t.prisma.eventSession.findFirst({ where: { contestId: c.id, title: { startsWith: 'Week 3' } } });

  // Capacity 3 with 2 registered: the juror gets the last place, the next person waits.
  const juror = await session('Juror');
  assert.match(await juror.flash(`${base}/sessions/${week3.id}/register`), /registered/);
  const steward = await session('Steward');
  assert.match(await steward.flash(`${base}/sessions/${week3.id}/register`), /waiting list/);
  assert.ok(await t.prisma.contestMembership.findFirst({ where: { contestId: c.id, userId: ids.Steward, role: 'participant', status: 'active' } }), 'registering joins the event');
  // A place opens: the first person waiting moves up.
  await juror.post(`${base}/sessions/${week3.id}/cancel`);
  const stewardRow = await t.prisma.sessionAttendance.findUnique({ where: { sessionId_userId: { sessionId: week3.id, userId: ids.Steward } } });
  assert.equal(stewardRow.status, 'registered');

  const organizer = await session('Organizer');
  assert.equal((await juror.post(`${base}/sessions/${week3.id}/attendance`, { present: String(ids.Participant) })).status, 403);
  assert.match(await organizer.flash(`${base}/sessions/${week3.id}/attendance`, { present: String(ids.Participant) }), /1 attended/);
  const held = await t.prisma.eventSession.findUnique({ where: { id: week3.id } });
  assert.equal(held.status, 'held');

  // Two sessions earn the certificate: the participant has three, the steward none.
  assert.equal((await (await session('Participant')).get(`${base}/sessions/certificate`)).status, 200);
  assert.equal((await steward.get(`${base}/sessions/certificate`)).status, 302);

  const bad = await organizer.post(`${base}/sessions`, { title: 'Online', mode: 'online', startsAt: '2026-12-01T10:00' });
  assert.equal(bad.status, 422);
  assert.match(bad.body, /meeting link/);
  const ok = await organizer.post(`${base}/sessions`, { title: 'Week 5: Wikidata', mode: 'online', startsAt: '2026-12-01T10:00', meetingUrl: 'https://meet.jit.si/x', capacity: '10' });
  assert.equal(ok.status, 302);
});
