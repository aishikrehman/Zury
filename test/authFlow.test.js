const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { createMockWikimedia } = require('./helpers/mockWikimedia');

const CONSUMER_KEY = 'flowkey';
const CONSUMER_SECRET = 'flowsecret';
const USER = { wikimediaId: 777, username: 'Test User', homeWiki: 'bnwiki', registered: '20100101000000' };
const dbFile = path.join(os.tmpdir(), `zury-test-${process.pid}.db`);

const mock = createMockWikimedia({ consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET, user: USER });
let server;
let appUrl;
let prisma;

before(async () => {
  const baseUrl = await mock.start();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    SESSION_SECRET: 'flow-test-secret',
    DATABASE_URL: `file:${dbFile.replace(/\\/g, '/')}`,
    WIKIMEDIA_CONSUMER_KEY: CONSUMER_KEY,
    WIKIMEDIA_CONSUMER_SECRET: CONSUMER_SECRET,
    WIKIMEDIA_CALLBACK_URL: 'http://127.0.0.1:5000/',
    WIKIMEDIA_OAUTH_BASE_URL: baseUrl,
  });
  execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });

  const app = require('../src/app');
  prisma = require('../src/config/prisma');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  appUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  await mock.stop();
  for (const f of [dbFile, `${dbFile}-journal`]) fs.rmSync(f, { force: true });
});

async function request(pathname, { cookie, method = 'GET', form } = {}) {
  const res = await fetch(appUrl + pathname, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie && { Cookie: cookie }),
      ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: form && new URLSearchParams(form).toString(),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('zury.sid='));
  return {
    status: res.status,
    location: res.headers.get('location'),
    cookie: setCookie ? setCookie.split(';')[0] : null,
    body: await res.text(),
  };
}

const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

async function logIn() {
  const protectedHit = await request('/dashboard');
  assert.equal(protectedHit.status, 302);
  assert.equal(protectedHit.location, '/login');
  const preLoginCookie = protectedHit.cookie;

  const login = await request('/login', { cookie: preLoginCookie });
  assert.equal(login.status, 302);
  const authorizeUrl = new URL(login.location);
  assert.equal(authorizeUrl.pathname, '/wiki/Special:OAuth/authorize');

  const requestKey = authorizeUrl.searchParams.get('oauth_token');
  const { verifier, callback } = mock.approve(requestKey);
  assert.equal(callback, 'http://127.0.0.1:5000/auth/callback');

  const cb = await request(`/auth/callback?oauth_token=${requestKey}&oauth_verifier=${verifier}`, {
    cookie: preLoginCookie,
  });
  assert.equal(cb.status, 302);
  assert.equal(cb.location, '/dashboard', 'returns to the originally requested page');
  assert.ok(cb.cookie && cb.cookie !== preLoginCookie, 'session id is regenerated on login');
  return { cookie: cb.cookie, preLoginCookie, requestKey, verifier };
}

test('anonymous visitors see public pages without getting a session', async () => {
  for (const page of ['/', '/about']) {
    const res = await request(page);
    assert.equal(res.status, 200);
    assert.equal(res.cookie, null);
    assert.match(res.body, /Log in with Wikimedia/);
  }
});

test('login, session, profile, settings and logout', async () => {
  const { cookie, preLoginCookie, requestKey, verifier } = await logIn();

  const dashboard = await request('/dashboard', { cookie });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.body, /Welcome, Test User/);

  assert.equal((await request('/dashboard', { cookie: preLoginCookie })).status, 302, 'old session id is not logged in');

  const replay = await request(`/auth/callback?oauth_token=${requestKey}&oauth_verifier=${verifier}`, { cookie });
  assert.equal(replay.status, 400, 'callback cannot be replayed');

  const stored = await prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(stored.username, 'Test User');
  assert.equal(stored.homeWiki, 'bnwiki');
  assert.deepEqual(stored.wikimediaRegisteredAt, new Date('2010-01-01T00:00:00Z'));
  assert.ok(stored.lastLoginAt);

  const profile = await request('/users/Test%20User');
  assert.equal(profile.status, 200, 'profiles are public');
  assert.match(profile.body, /bnwiki/);
  assert.equal((await request('/users/Nobody')).status, 404);

  const settingsPage = await request('/settings', { cookie });
  assert.equal(settingsPage.status, 200);
  const csrf = csrfFrom(settingsPage.body);

  const noToken = await request('/settings', { cookie, method: 'POST', form: { timezone: 'Asia/Dhaka' } });
  assert.equal(noToken.status, 403);

  const invalid = await request('/settings', {
    cookie,
    method: 'POST',
    form: { _csrf: csrf, preferredLanguage: '<script>', timezone: 'Mars/Base' },
  });
  assert.equal(invalid.status, 422);
  assert.match(invalid.body, /Unknown timezone/);
  assert.ok(!invalid.body.includes('value="<script>"'), 'submitted values are escaped');

  const saved = await request('/settings', {
    cookie,
    method: 'POST',
    form: { _csrf: csrf, preferredLanguage: 'bn', timezone: 'Asia/Dhaka' },
  });
  assert.equal(saved.status, 302);
  assert.equal(saved.location, '/settings?saved=1');
  const updated = await prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(updated.preferredLanguage, 'bn');
  assert.equal(updated.timezone, 'Asia/Dhaka');

  const relogin = await logIn();
  const afterRelogin = await prisma.user.findUnique({ where: { wikimediaId: 777 } });
  assert.equal(afterRelogin.preferredLanguage, 'bn', 'login sync keeps local preferences');
  assert.equal(await prisma.user.count(), 1, 'second login updates, not duplicates');

  const reloginDashboard = await request('/dashboard', { cookie: relogin.cookie });
  const logout = await request('/logout', {
    cookie: relogin.cookie,
    method: 'POST',
    form: { _csrf: csrfFrom(reloginDashboard.body) },
  });
  assert.equal(logout.status, 302);
  assert.equal((await request('/dashboard', { cookie: relogin.cookie })).status, 302, 'logged out');
});

test('callback rejects a mismatched or missing request token', async () => {
  const res = await request('/auth/callback?oauth_token=abc&oauth_verifier=def');
  assert.equal(res.status, 400);
  assert.match(res.body, /invalid or has expired/);
});
