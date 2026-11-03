const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET ||= 'test';
const { zonedLocalToUtc, utcToZonedLocal } = require('../src/utils/time');
const form = require('../src/services/contestFormService');
const { computeAutoStatus, applyAction } = require('../src/services/lifecycleService');
const { checkEligibility, roleConflict } = require('../src/services/membershipService');
const { parseTypeConfig, readTypeConfig } = require('../src/events/eventTypes');

test('local times convert to and from UTC, including DST', () => {
  assert.equal(zonedLocalToUtc('2026-09-01T09:30', 'Asia/Dhaka').toISOString(), '2026-09-01T03:30:00.000Z');
  assert.equal(zonedLocalToUtc('2026-07-01T12:00', 'America/New_York').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(zonedLocalToUtc('2026-12-01T12:00', 'America/New_York').toISOString(), '2026-12-01T17:00:00.000Z');
  assert.equal(utcToZonedLocal(new Date('2026-09-01T03:30:00Z'), 'Asia/Dhaka'), '2026-09-01T09:30');
  assert.equal(zonedLocalToUtc('2026-02-31T10:00', 'UTC'), null);
  assert.equal(zonedLocalToUtc('nonsense', 'UTC'), null);
});

const validBody = {
  title: 'Wiki Loves Test 2027',
  primaryWiki: 'commonswiki',
  timezone: 'Asia/Dhaka',
  language: 'bn',
  startDate: '2027-01-01T00:00',
  endDate: '2027-01-31T23:59',
  minAccountAgeDays: '0',
  minEditCount: '0',
};
const anyWiki = () => true;

test('form parsing: valid input, slug generation and defaults', () => {
  const r = form.parse(validBody, { type: 'photo', wikiAllowed: anyWiki });
  assert.deepEqual(r.errors, {});
  assert.equal(r.contest.slug, 'wiki-loves-test-2027');
  assert.equal(r.contest.startDate.toISOString(), '2026-12-31T18:00:00.000Z');
  assert.equal(r.contest.visibility, 'public');
  assert.equal(r.settings.participantLimit, null);
  assert.deepEqual(JSON.parse(r.settings.typeConfig).awardCategories, []);
});

test('form parsing rejects bad input with field errors', () => {
  const r = form.parse(
    {
      ...validBody,
      title: 'x',
      slug: 'Bad Slug!',
      primaryWiki: 'https://bn.wikipedia.org',
      additionalWikis: 'enwiki\nnot a wiki',
      timezone: 'Mars/Base',
      bannerUrl: 'https://evil.example/banner.png',
      logoUrl: 'http://upload.wikimedia.org/x.png',
      minEditCount: '-5',
      participantLimit: '0',
      eligibleNamespaces: '0, abc',
      type_minResolutionMegapixels: '999',
    },
    { type: 'photo', wikiAllowed: anyWiki },
  );
  for (const key of ['title', 'slug', 'primaryWiki', 'additionalWikis', 'timezone', 'bannerUrl', 'logoUrl', 'minEditCount', 'participantLimit', 'eligibleNamespaces', 'type_minResolutionMegapixels']) {
    assert.ok(r.errors[key], `expected an error for ${key}`);
  }
});

test('form parsing enforces date order and wiki permissions', () => {
  const r = form.parse({ ...validBody, endDate: '2026-12-01T00:00', registrationOpensAt: '2027-01-10T00:00', registrationClosesAt: '2027-01-01T00:00' }, { type: 'photo', wikiAllowed: anyWiki });
  assert.ok(r.errors.endDate);
  assert.ok(r.errors.registrationClosesAt);
  const denied = form.parse(validBody, { type: 'photo', wikiAllowed: (w) => w === 'bnwiki' });
  assert.match(denied.errors.primaryWiki, /can't use/);
});

test('type configs validate and fill in new defaults', () => {
  const bad = parseTypeConfig('data', { entityTypes: ['item', 'galaxy'], requiredProperties: 'P17\nQ5', minStatements: '2' });
  assert.ok(bad.errors.entityTypes);
  assert.ok(bad.errors.requiredProperties);
  const good = parseTypeConfig('data', { entityTypes: 'lexeme', requiredProperties: 'P17, P625', minStatements: '2' });
  assert.deepEqual(good.errors, {});
  assert.deepEqual(good.values, { entityTypes: ['lexeme'], requiredProperties: ['P17', 'P625'], minStatements: 2 });
  assert.equal(readTypeConfig('writing', '{"minWordCount":50,"bogus":1}').minWordCount, 50);
  assert.equal(readTypeConfig('writing', '{"minWordCount":50}').minBytes, 3000);
  assert.equal(readTypeConfig('writing', 'not json').minWordCount, 300);
});

test('automatic status follows the dates', () => {
  const at = (s) => new Date(s);
  const c = {
    startDate: at('2026-09-01T00:00:00Z'),
    endDate: at('2026-09-30T00:00:00Z'),
    submissionDeadline: at('2026-09-25T00:00:00Z'),
    reviewOpensAt: at('2026-10-01T00:00:00Z'),
    reviewDeadline: at('2026-10-15T00:00:00Z'),
  };
  const jury = { juryReviewEnabled: true };
  assert.equal(computeAutoStatus(c, jury, at('2026-08-01T00:00:00Z')), 'upcoming');
  assert.equal(computeAutoStatus(c, jury, at('2026-09-10T00:00:00Z')), 'active');
  assert.equal(computeAutoStatus(c, jury, at('2026-09-27T00:00:00Z')), 'submission_closed');
  assert.equal(computeAutoStatus(c, jury, at('2026-10-05T00:00:00Z')), 'under_review');
  assert.equal(computeAutoStatus(c, jury, at('2026-10-20T00:00:00Z')), 'completed');
  assert.equal(computeAutoStatus({ ...c, reviewDeadline: null }, jury, at('2027-01-01T00:00:00Z')), 'under_review');
  const noJury = { juryReviewEnabled: false };
  assert.equal(computeAutoStatus(c, noJury, at('2026-09-27T00:00:00Z')), 'submission_closed');
  assert.equal(computeAutoStatus(c, noJury, at('2026-10-01T00:00:00Z')), 'completed');
  assert.equal(computeAutoStatus({ startDate: null, endDate: null }, jury), 'published');
});

test('lifecycle actions enforce allowed transitions', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  const dated = { startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T00:00:00Z') };
  const s = { juryReviewEnabled: true };
  assert.deepEqual(applyAction({ ...dated, status: 'draft' }, s, { action: 'publish' }, now), { status: 'active', statusMode: 'auto' });
  assert.throws(() => applyAction({ status: 'draft' }, s, { action: 'publish' }, now), /start and end dates/);
  assert.deepEqual(applyAction({ ...dated, status: 'active' }, s, { action: 'set_status', status: 'under_review' }, now), { status: 'under_review', statusMode: 'manual' });
  assert.throws(() => applyAction({ ...dated, status: 'active' }, s, { action: 'set_status', status: 'draft' }, now));
  assert.deepEqual(applyAction({ ...dated, status: 'under_review', statusMode: 'manual' }, s, { action: 'resume_auto' }, now), { status: 'active', statusMode: 'auto' });
  assert.throws(() => applyAction({ ...dated, status: 'active' }, s, { action: 'unpublish' }, now));
  assert.throws(() => applyAction({ ...dated, status: 'active' }, s, { action: 'archive' }, now));
  assert.equal(applyAction({ ...dated, status: 'active' }, s, { action: 'cancel' }, now).status, 'cancelled');
  assert.equal(applyAction({ ...dated, status: 'cancelled' }, s, { action: 'reopen' }, now).status, 'draft');
  assert.throws(() => applyAction({ ...dated, status: 'draft' }, s, { action: 'teleport' }, now), /Unknown/);
});

test('eligibility explains every failed rule', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const contest = { status: 'upcoming', registrationOpensAt: new Date('2026-10-01T00:00:00Z'), registrationClosesAt: new Date('2027-02-28T00:00:00Z') };
  const settings = { ...form.defaultSettings('writing'), minEditCount: 100, minAccountAgeDays: 30, participantLimit: 2 };
  const veteran = { wikimediaRegisteredAt: new Date('2015-01-01T00:00:00Z'), globalEditCount: 5000 };
  const newbie = { wikimediaRegisteredAt: new Date('2026-10-20T00:00:00Z'), globalEditCount: 12 };

  assert.deepEqual(checkEligibility({ user: veteran, contest, settings, roles: [], participants: 0, now }), { eligible: true, reasons: [] });
  const r = checkEligibility({ user: newbie, contest, settings, roles: [], participants: 2, now });
  assert.equal(r.eligible, false);
  assert.equal(r.reasons.length, 3, r.reasons.join(' | '));
  assert.ok(checkEligibility({ user: veteran, contest: { ...contest, status: 'completed' }, settings, roles: [], participants: 0, now }).reasons.some((x) => /not open/.test(x)));
  assert.ok(checkEligibility({ user: veteran, contest, settings, roles: ['jury'], participants: 0, now }).reasons.some((x) => /Jury/.test(x)));
  assert.ok(checkEligibility({ user: { wikimediaRegisteredAt: null, globalEditCount: null }, contest, settings, roles: [], participants: 0, now }).reasons.some((x) => /verified/.test(x)));
  assert.equal(checkEligibility({ user: null, contest, settings, roles: [], participants: 0, now }).eligible, false);
});

test('role conflicts follow the event settings', () => {
  const strict = { allowJuryParticipation: false, allowOrganizerParticipation: false };
  assert.ok(roleConflict('participant', ['jury'], strict));
  assert.ok(roleConflict('jury', ['participant'], strict));
  assert.ok(roleConflict('organizer', ['participant'], strict));
  assert.equal(roleConflict('participant', ['jury'], { ...strict, allowJuryParticipation: true }), null);
  assert.equal(roleConflict('viewer', ['participant'], strict), null);
});
