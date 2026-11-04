const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { NAME, LABEL } = require('./helpers/people');
const { startTestApp, csrfFrom } = require('./helpers/testApp');

let t;
let ids;

before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  const { seedDemoData } = require('../prisma/seed');
  await seedDemoData(t.prisma);
  await seedDemoData(t.prisma); // re-running must replace, not duplicate
  const contests = await t.prisma.contest.findMany();
  const users = await t.prisma.user.findMany();
  ids = {
    contest: Object.fromEntries(contests.map((c) => [c.slug, c.id])),
    user: Object.fromEntries(users.map((u) => [u.username, u.id])),
  };
});

after(() => t?.stop());

async function loginAs(username) {
  const page = await t.request('/demo');
  const res = await t.request('/demo/login', {
    cookie: page.cookie,
    method: 'POST',
    form: { _csrf: csrfFrom(page.body), userId: ids.user[username] },
  });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/dashboard');
  return res.cookie;
}

test('demo mode is never enabled in production', () => {
  const { isDemoModeEnabled } = require('../src/config/env');
  assert.equal(isDemoModeEnabled({ DEMO_MODE: 'true', NODE_ENV: 'production' }), false);
  assert.equal(isDemoModeEnabled({ DEMO_MODE: 'true', NODE_ENV: 'development' }), true);
  assert.equal(isDemoModeEnabled({ NODE_ENV: 'development' }), false);
});

test('seed is idempotent', async () => {
  assert.equal(await t.prisma.user.count({ where: { isDemo: true, wikimediaId: { gt: -1000 } } }), 9, 'the switchable demo users');
  assert.equal(await t.prisma.contest.count({ where: { isDemo: true } }), 13);
  // The edition copied from Fountain, with its real articles and jury marks.
  const wam25 = await t.prisma.contest.findUnique({ where: { slug: 'wam-2025' }, include: { _count: { select: { submissions: true, reviews: true } } } });
  assert.equal(wam25._count.submissions, 137);
  assert.ok(wam25._count.reviews >= 137);
  assert.equal(await t.prisma.eventSeries.count({ where: { isDemo: true } }), 2);
});

test('public pages show demo events but never private ones', async () => {
  const home = await t.request('/');
  assert.match(home.body, /Wiki Loves Monuments 2026 in Bangladesh/);
  assert.doesNotMatch(home.body, /Jury Calibration Round/);
  const events = await t.request('/events?type=photo');
  assert.match(events.body, /Wiki Loves Earth 2026/);
  assert.doesNotMatch(events.body, /Liberation War/);
  const profile = await t.request(`/users/${encodeURIComponent(NAME.Juror)}`);
  assert.doesNotMatch(profile.body, /Jury Calibration Round/, 'private membership not shown on public profile');
});

test('demo login requires a CSRF token and only accepts demo users', async () => {
  const page = await t.request('/demo');
  assert.equal(page.status, 200);
  const noToken = await t.request('/demo/login', { cookie: page.cookie, method: 'POST', form: { userId: ids.user[NAME.Steward] } });
  assert.equal(noToken.status, 403);
});

test('each demo user gets exactly the access their roles allow', async () => {
  const c = ids.contest;
  const paths = {
    wlm: `/contest/${c['wlm-bangladesh-2026']}`,
    wlmConfig: `/contest/${c['wlm-bangladesh-2026']}/config`,
    wlmPeople: `/contest/${c['wlm-bangladesh-2026']}/participants`,
    bnConfig: `/contest/${c['bnwiki-womens-history-2027']}/config`,
    private: `/contest/${c['enwiki-jury-calibration']}`,
    admin: '/admin',
    logs: '/admin/logs',
  };
  const expected = {
    [NAME['Steward']]: [200, 200, 200, 200, 200, 403, 403],
    [NAME['Global Sysop']]: [200, 200, 200, 200, 200, 403, 403],
    [NAME['Bn Admin']]: [200, 403, 403, 200, 404, 403, 403],
    [NAME['Platform Admin']]: [200, 403, 403, 403, 404, 200, 200],
    [NAME['Organizer']]: [200, 200, 200, 200, 404, 403, 403],
    [NAME['Juror']]: [200, 403, 403, 403, 200, 403, 403],
    [NAME['Participant']]: [200, 403, 403, 403, 200, 403, 403],
    [NAME['Newcomer']]: [200, 403, 403, 403, 404, 403, 403],
  };
  for (const [username, codes] of Object.entries(expected)) {
    const cookie = await loginAs(username);
    const actual = [];
    for (const p of Object.values(paths)) actual.push((await t.request(p, { cookie })).status);
    assert.deepEqual(actual, codes, username);
  }
});

test('overrides show up in the event access panel', async () => {
  const wlm = `/contest/${ids.contest['wlm-bangladesh-2026']}`;
  const juror = await t.request(wlm, { cookie: await loginAs(NAME.Juror) });
  assert.match(juror.body, /exportData/);
  const editathon = `/contest/${ids.contest['liberation-war-editathon']}`;
  const organizer = await t.request(editathon, { cookie: await loginAs(NAME.Organizer) });
  assert.match(organizer.body, /− sendMassMessage/);
  assert.doesNotMatch(organizer.body, /Send MassMessage campaigns/, 'denied permission is not listed as held');
});

test('platform admins grant and revoke roles with an audit trail', async () => {
  const adminCookie = await loginAs(NAME['Platform Admin']);
  const usersPage = await t.request('/admin/users', { cookie: adminCookie });
  assert.equal(usersPage.status, 200);
  const csrf = csrfFrom(usersPage.body);
  const target = ids.user[NAME.Organizer];

  const grant = await t.request(`/admin/users/${target}/roles`, { cookie: adminCookie, method: 'POST', form: { _csrf: csrf, role: 'platform-admin' } });
  assert.equal(grant.status, 302);
  assert.ok(await t.prisma.userGlobalRole.findFirst({ where: { userId: target, role: 'platform-admin' } }));

  const steward = await t.request(`/admin/users/${target}/roles`, { cookie: adminCookie, method: 'POST', form: { _csrf: csrf, role: 'steward' } });
  assert.equal(steward.status, 400, 'Wikimedia roles cannot be granted in Zury');

  const self = await t.request(`/admin/users/${ids.user[NAME['Platform Admin']]}/roles/revoke`, {
    cookie: adminCookie,
    method: 'POST',
    form: { _csrf: csrf, role: 'platform-admin' },
  });
  assert.equal(self.status, 400, 'cannot revoke own role');

  const revoke = await t.request(`/admin/users/${target}/roles/revoke`, { cookie: adminCookie, method: 'POST', form: { _csrf: csrf, role: 'platform-admin' } });
  assert.equal(revoke.status, 302);
  assert.equal(await t.prisma.userGlobalRole.count({ where: { userId: target, role: 'platform-admin' } }), 0);

  const actions = (
    await t.prisma.auditLog.findMany({
      where: { entityId: String(target), actorId: ids.user[NAME['Platform Admin']], action: { startsWith: 'platformRole.' } },
    })
  ).map((l) => l.action);
  assert.deepEqual(actions.sort(), ['platformRole.granted', 'platformRole.revoked']);

  const stewardCookie = await loginAs(NAME.Steward);
  const stewardPage = await t.request('/dashboard', { cookie: stewardCookie });
  const forbidden = await t.request(`/admin/users/${target}/roles`, {
    cookie: stewardCookie,
    method: 'POST',
    form: { _csrf: csrfFrom(stewardPage.body), role: 'platform-admin' },
  });
  assert.equal(forbidden.status, 403, 'stewards cannot grant platform roles');
});
