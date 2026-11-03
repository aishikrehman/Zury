const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET ||= 'test';
const { buildSubject, globalPermissions, computeContestScope, expand, EMPTY_SUBJECT } = require('../src/services/permissionService');
const registry = require('../src/permissions/registry');

const now = new Date();
const right = (wiki, rightName, extra = {}) => ({ wiki, rightName, verifiedAt: now, verificationSource: 'globaluserinfo', ...extra });
const user = (id, { wikiRoles = [], globalRoles = [] } = {}) => ({ id, wikiRoles, globalRoles });
const contest = (primaryWiki) => ({ id: 1, primaryWiki });
const member = (role, status = 'active') => ({ role, status });

test('registry is internally consistent', () => {
  assert.doesNotThrow(() => registry.validateRegistry());
});

test('implications are transitive and include the original key', () => {
  const perms = expand(['viewAllSubmissions', 'manageAnyEvent']);
  for (const key of ['viewAllSubmissions', 'viewSubmissions', 'viewOwnSubmissions', 'manageAnyEvent', 'manageEvent']) {
    assert.ok(perms.has(key), key);
  }
});

test('anonymous visitors have no permissions', () => {
  assert.equal(globalPermissions(EMPTY_SUBJECT).size, 0);
  assert.equal(computeContestScope(EMPTY_SUBJECT, contest('bnwiki')).permissions.size, 0);
});

test('steward has platform-wide event authority', () => {
  const s = buildSubject(user(1, { wikiRoles: [right('*', 'steward')] }));
  const scope = computeContestScope(s, contest('enwiki'));
  for (const p of ['editEvent', 'manageEvent', 'deleteEvent', 'manageJury', 'publishResults']) assert.ok(scope.permissions.has(p), p);
  assert.ok(globalPermissions(s).has('createEvent'));
  assert.ok(!globalPermissions(s).has('accessAdmin'), 'Wikimedia authority is not Zury administration');
});

test('global sysop can manage but not delete events', () => {
  const s = buildSubject(user(1, { wikiRoles: [right('*', 'global-sysop')] }));
  const scope = computeContestScope(s, contest('enwiki'));
  assert.ok(scope.permissions.has('manageEvent'));
  assert.ok(!scope.permissions.has('deleteEvent'));
});

test('local admin authority is limited to their own wiki', () => {
  const s = buildSubject(user(1, { wikiRoles: [right('bnwiki', 'sysop')] }));
  assert.ok(computeContestScope(s, contest('bnwiki')).permissions.has('manageEvent'));
  assert.ok(computeContestScope(s, contest('bnwiki')).isLocalAdminHere);
  assert.ok(!computeContestScope(s, contest('enwiki')).permissions.has('manageEvent'));
  assert.ok(globalPermissions(s).has('createEvent'));
  assert.ok(!globalPermissions(s).has('manageEvent'));
});

test('a global "sysop" row or local "steward" row grants nothing', () => {
  const s = buildSubject(user(1, { wikiRoles: [right('*', 'sysop'), right('bnwiki', 'steward')] }));
  assert.equal(s.platformRoles.size, 0);
});

test('stale verified rights are ignored, demo rights never expire', () => {
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  assert.equal(buildSubject(user(1, { wikiRoles: [right('*', 'steward', { verifiedAt: old })] })).platformRoles.size, 0);
  const demo = buildSubject(user(1, { wikiRoles: [right('*', 'steward', { verifiedAt: old, verificationSource: 'demo' })] }));
  assert.ok(demo.platformRoles.has('steward'));
});

test('platform admin is Zury-assigned and has no event authority', () => {
  const s = buildSubject(user(1, { globalRoles: [{ role: 'platform-admin' }] }));
  assert.ok(globalPermissions(s).has('accessAdmin'));
  assert.ok(!computeContestScope(s, contest('bnwiki')).permissions.has('manageEvent'));
});

test('Wikimedia-derived roles cannot be assigned through Zury', () => {
  const s = buildSubject(user(1, { globalRoles: [{ role: 'steward' }, { role: 'local-admin' }] }));
  assert.equal(s.platformRoles.size, 0);
});

test('event roles apply only within their event and combine', () => {
  const s = buildSubject(user(1));
  const scope = computeContestScope(s, contest('bnwiki'), [member('jury'), member('participant')]);
  assert.deepEqual(scope.eventRoles.sort(), ['jury', 'participant']);
  for (const p of ['reviewAssignedEntry', 'submitEntry', 'createAppeal']) assert.ok(scope.permissions.has(p), p);
  assert.ok(!scope.permissions.has('manageEvent'));
  assert.equal(computeContestScope(s, contest('bnwiki'), []).permissions.size, 0);
});

test('organizer manages their own event', () => {
  const scope = computeContestScope(buildSubject(user(1)), contest('bnwiki'), [member('organizer')]);
  for (const p of ['editEvent', 'deleteEvent', 'manageEvent', 'manageJury']) assert.ok(scope.permissions.has(p), p);
});

test('inactive memberships and unknown roles grant nothing', () => {
  const scope = computeContestScope(buildSubject(user(1)), contest('bnwiki'), [member('organizer', 'removed'), member('overlord')]);
  assert.equal(scope.permissions.size, 0);
});

test('overrides adjust event permissions but never platform authority', () => {
  const juror = computeContestScope(buildSubject(user(1)), contest('bnwiki'), [member('jury')], [
    { permission: 'exportData', allowed: true },
    { permission: 'massReview', allowed: false },
  ]);
  assert.ok(juror.permissions.has('exportData'));
  assert.ok(!juror.permissions.has('massReview'));

  const steward = buildSubject(user(2, { wikiRoles: [right('*', 'steward')] }));
  const denied = computeContestScope(steward, contest('bnwiki'), [], [{ permission: 'manageEvent', allowed: false }]);
  assert.ok(denied.permissions.has('manageEvent'));
});
