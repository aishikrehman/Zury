const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMockWikimedia } = require('./helpers/mockWikimedia');
const { startTestApp, csrfFrom } = require('./helpers/testApp');

const CONSUMER_KEY = 'flowkey';
const CONSUMER_SECRET = 'flowsecret';
const USER = {
  wikimediaId: 777,
  username: 'Test User',
  homeWiki: 'bnwiki',
  registered: '20100101000000',
  globalGroups: [],
  localGroups: [{ wiki: 'bnwiki', groups: ['sysop', 'rollbacker'] }],
};

const mock = createMockWikimedia({ consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET, user: USER });
let t;

before(async () => {
  const baseUrl = await mock.start();
  t = await startTestApp({
    WIKIMEDIA_CONSUMER_KEY: CONSUMER_KEY,
    WIKIMEDIA_CONSUMER_SECRET: CONSUMER_SECRET,
    WIKIMEDIA_OAUTH_BASE_URL: baseUrl,
    // Behave like production regardless of the developer's .env.
    DEMO_MODE: 'false',
  });
});

after(async () => {
  await t?.stop();
  await mock.stop();
});

async function logIn(startPath = '/dashboard') {
  const protectedHit = await t.request(startPath);
  assert.equal(protectedHit.status, 302);
  assert.equal(protectedHit.location, '/login');
  const preLoginCookie = protectedHit.cookie;

  const login = await t.request('/login', { cookie: preLoginCookie });
  assert.equal(login.status, 302);
  const authorizeUrl = new URL(login.location);
  assert.equal(authorizeUrl.pathname, '/wiki/Special:OAuth/authorize');

  const requestKey = authorizeUrl.searchParams.get('oauth_token');
  const { verifier, callback } = mock.approve(requestKey);
  assert.equal(callback, 'oob');

  const cb = await t.request(`/?oauth_token=${requestKey}&oauth_verifier=${verifier}`, { cookie: preLoginCookie });
  assert.equal(cb.status, 302);
  assert.equal(cb.location, startPath, 'returns to the originally requested page');
  assert.ok(cb.cookie && cb.cookie !== preLoginCookie, 'session id is regenerated on login');
  return { cookie: cb.cookie, preLoginCookie, requestKey, verifier };
}

test('anonymous visitors see public pages without getting a session', async () => {
  for (const page of ['/', '/about', '/events']) {
    const res = await t.request(page);
    assert.equal(res.status, 200, page);
    assert.equal(res.cookie, null, page);
    assert.match(res.body, /href="\/login"/, 'a way to log in');
  }
});

test('login, session, profile, settings and logout', async () => {
  const { cookie, preLoginCookie, requestKey, verifier } = await logIn();

  const dashboard = await t.request('/dashboard', { cookie });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.body, /Welcome back, Test User/);

  assert.equal((await t.request('/dashboard', { cookie: preLoginCookie })).status, 302, 'old session id is not logged in');

  const replay = await t.request(`/auth/callback?oauth_token=${requestKey}&oauth_verifier=${verifier}`, { cookie });
  assert.equal(replay.status, 400, 'callback cannot be replayed');

  const stored = await t.prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(stored.username, 'Test User');
  assert.equal(stored.homeWiki, 'bnwiki');
  assert.deepEqual(stored.wikimediaRegisteredAt, new Date('2010-01-01T00:00:00Z'));
  assert.ok(stored.lastLoginAt);

  const profile = await t.request('/users/Test%20User');
  assert.equal(profile.status, 200, 'profiles are public');
  assert.match(profile.body, /bnwiki/);
  assert.equal((await t.request('/users/Nobody')).status, 404);

  const settingsPage = await t.request('/settings', { cookie });
  const csrf = csrfFrom(settingsPage.body);

  assert.equal((await t.request('/settings', { cookie, method: 'POST', form: { timezone: 'Asia/Dhaka' } })).status, 403);

  const invalid = await t.request('/settings', {
    cookie,
    method: 'POST',
    form: { _csrf: csrf, preferredLanguage: '<script>', timezone: 'Mars/Base' },
  });
  assert.equal(invalid.status, 422);
  assert.match(invalid.body, /Unknown timezone/);
  assert.ok(!invalid.body.includes('value="<script>"'), 'submitted values are escaped');

  const saved = await t.request('/settings', {
    cookie,
    method: 'POST',
    form: { _csrf: csrf, preferredLanguage: 'bn', timezone: 'UTC' },
  });
  assert.equal(saved.status, 302);
  const updated = await t.prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(updated.preferredLanguage, 'bn');
  assert.equal(updated.timezone, 'UTC');

  const relogin = await logIn();
  const afterRelogin = await t.prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(afterRelogin.preferredLanguage, 'bn', 'login sync keeps local preferences');
  assert.equal(await t.prisma.user.count(), 1, 'second login updates, not duplicates');

  const reloginDashboard = await t.request('/dashboard', { cookie: relogin.cookie });
  const logout = await t.request('/logout', { cookie: relogin.cookie, method: 'POST', form: { _csrf: csrfFrom(reloginDashboard.body) } });
  assert.equal(logout.status, 302);
  assert.equal((await t.request('/dashboard', { cookie: relogin.cookie })).status, 302, 'logged out');
});

test('login verifies Wikimedia groups and applies wiki-scoped authority', async () => {
  const { cookie } = await logIn();
  const user = await t.prisma.user.findUnique({ where: { wikimediaId: 777 }, include: { wikiRoles: true } });
  assert.deepEqual(user.wikiRoles.map((r) => [r.wiki, r.rightName, r.verificationSource]), [['bnwiki', 'sysop', 'globaluserinfo']]);
  assert.ok(user.rightsCheckedAt);
  assert.ok(await t.prisma.auditLog.findFirst({ where: { action: 'wikiRights.verified', actorId: user.id } }));

  const make = (data) => t.prisma.contest.create({ data: { type: 'writing', ...data } });
  const bnPrivate = await make({ slug: 'bn-private', title: 'Bn private', primaryWiki: 'bnwiki', status: 'draft', visibility: 'private' });
  const enPrivate = await make({ slug: 'en-private', title: 'En private', primaryWiki: 'enwiki', status: 'draft', visibility: 'private' });
  const enPublic = await make({ slug: 'en-public', title: 'En public', primaryWiki: 'enwiki', status: 'active' });

  assert.equal((await t.request(`/contest/${bnPrivate.id}`, { cookie })).status, 200, 'local admin sees own-wiki drafts');
  assert.equal((await t.request(`/contest/${bnPrivate.id}/config`, { cookie })).status, 200);
  assert.equal((await t.request(`/contest/${enPrivate.id}`, { cookie })).status, 404, 'other wikis stay hidden');
  assert.equal((await t.request(`/contest/${enPublic.id}`, { cookie })).status, 200);
  assert.equal((await t.request(`/contest/${enPublic.id}/config`, { cookie })).status, 403);
  assert.equal((await t.request(`/contest/${bnPrivate.id}`)).status, 404, 'anonymous visitors cannot see drafts');
  assert.equal((await t.request('/admin', { cookie })).status, 403, 'wiki admins are not Zury admins');

  // A failed lookup keeps the last verified rights.
  mock.apiDown = true;
  await t.prisma.user.update({ where: { id: user.id }, data: { rightsCheckedAt: new Date(Date.now() - 2 * 86400000) } });
  assert.equal((await t.request(`/contest/${bnPrivate.id}`, { cookie })).status, 200);
  mock.apiDown = false;

  // The daily refresh drops a removed group without a new login.
  USER.localGroups = [];
  await t.prisma.user.update({ where: { id: user.id }, data: { rightsCheckedAt: new Date(Date.now() - 2 * 86400000) } });
  assert.equal((await t.request(`/contest/${bnPrivate.id}`, { cookie })).status, 404, 'desysop takes effect on refresh');
  USER.localGroups = [{ wiki: 'bnwiki', groups: ['sysop'] }];
});

test('callback rejects a mismatched or missing request token', async () => {
  const res = await t.request('/auth/callback?oauth_token=abc&oauth_verifier=def');
  assert.equal(res.status, 400);
  assert.match(res.body, /invalid or has expired/);
});
