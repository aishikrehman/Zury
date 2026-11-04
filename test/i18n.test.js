// Every string Zury shows has a Bangla translation, with the same {placeholders}.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestApp } = require('./helpers/testApp');

const root = path.join(__dirname, '..');

function files(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full, ext) : e.name.endsWith(ext) ? [full] : [];
  });
}

// Every English string shown: t()/th()/tn()/zt() calls, flash and validation
// messages (shown through t()), and the label tables.
function allKeys() {
  const keys = new Set();
  const add = (s) => typeof s === 'string' && /[A-Za-z]{2,}/.test(s) && keys.add(s);
  const unquote = (q, body) => (q === '"' ? JSON.parse(`"${body}"`) : body.replace(/\\'/g, "'"));
  const quoted = (n) => `(["'])((?:\\\\.|(?!\\${n}).)*)\\${n}`;

  for (const file of [...files(path.join(root, 'src'), '.ejs'), ...files(path.join(root, 'src'), '.js')]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(new RegExp(`\\b(?:t|th|req\\.t|zt)\\(${quoted(1)}`, 'g'))) add(unquote(m[1], m[2]));
    for (const m of text.matchAll(new RegExp(`\\btn\\(${quoted(1)},\\s*${quoted(3)}`, 'g'))) {
      add(unquote(m[1], m[2]));
      add(unquote(m[3], m[4]));
    }
    for (const m of text.matchAll(new RegExp(`req\\.flash\\(\\s*'\\w+',\\s*${quoted(1)}\\s*\\)`, 'g'))) add(unquote(m[1], m[2]));
    for (const m of text.matchAll(new RegExp(`errors(?:\\.\\w+|\\[[^\\]]+\\])\\s*=\\s*${quoted(1)}`, 'g'))) add(unquote(m[1], m[2]));
    for (const m of text.matchAll(new RegExp(`new \\w*Error\\(${quoted(1)}`, 'g'))) add(unquote(m[1], m[2]));
  }

  const labels = require('../src/utils/contestLabels');
  Object.values(labels.CONTEST_TYPES).forEach(add);
  Object.values(labels.PROJECT_CATEGORIES).forEach(add);
  for (const table of [labels.CONTEST_STATUSES, labels.SUBMISSION_STATUSES]) Object.values(table).forEach((o) => add(o.label));
  const form = require('../src/services/contestFormService');
  form.FEATURE_FIELDS.forEach(([, a, b]) => (add(a), add(b)));
  form.DATE_FIELDS.forEach(([, a]) => add(a));
  Object.values(form.PARTICIPATION_MODES).forEach(add);
  const reg = require('../src/permissions/registry');
  for (const o of [...Object.values(reg.EVENT_ROLES), ...Object.values(reg.PLATFORM_ROLES)]) [o.label, o.plural, o.description].forEach(add);
  Object.values(reg.PERMISSIONS).forEach(add);
  for (const type of Object.values(require('../src/events/eventTypes').EVENT_TYPES)) {
    [type.label, type.description, ...Object.values(type.guide || {})].forEach(add);
    for (const f of type.fields) [f.label, f.help, ...Object.values(f.choices || {})].forEach(add);
  }
  require('../src/i18n/client').CLIENT_STRINGS.forEach(add);
  const ss = require('../src/services/sessionService');
  [ss.MODES, ss.STATUSES, ss.ATTENDANCE].forEach((o) => Object.values(o).forEach(add));
  const ms = require('../src/services/messageService');
  [ms.METHODS, ms.AUDIENCES].forEach((o) => Object.values(o).forEach(add));
  Object.values(require('../src/services/trackingService').SOURCES).forEach(add);
  return [...keys].sort();
}

let t;
before(async () => {
  t = await startTestApp({ DEMO_MODE: 'true' });
  await require('../prisma/seed').seedDemoData(t.prisma);
});
after(() => t?.stop());

test('every string has a Bangla translation with the same placeholders', () => {
  const bn = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'bn.json'), 'utf8'));
  const keys = allKeys();
  assert.ok(keys.length > 500, `found ${keys.length} strings`);
  assert.deepEqual(keys.filter((k) => !(k in bn)), [], 'add these to src/i18n/bn.json');
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  assert.deepEqual(keys.filter((k) => names(k) !== names(bn[k])), [], 'placeholders must match');
});

test('the language follows the choice, the account and the browser', async () => {
  assert.match((await t.request('/events')).body, /<html lang="en"/);

  const browser = await fetch(`${t.baseUrl}/events`, { headers: { 'Accept-Language': 'bn-BD,bn;q=0.9,en;q=0.5' } });
  const bnPage = await browser.text();
  assert.match(bnPage, /<html lang="bn"/);
  assert.match(bnPage, /সব ইভেন্ট/);

  const chosen = await t.request('/preferences/language/bn?next=/events');
  assert.equal(chosen.status, 302);
  const page = await t.request('/wam/2026', { cookie: chosen.cookie });
  assert.match(page.body, /<html lang="bn"/);
  assert.match(page.body, /অংশ নিন/, 'event pages are translated');
  assert.match(page.body, /২০২৬/, 'dates use Bangla digits');
  assert.match(page.body, /ধাপ \{n\} \/ \{total\}/, 'scripts get their strings');
  assert.match(page.body, /Wikipedia Asian Month 2026/, 'event content itself is not translated');

  await t.request('/preferences/language/en?next=/', { cookie: chosen.cookie });
  assert.match((await t.request('/events', { cookie: chosen.cookie })).body, /<html lang="en"/);
});
