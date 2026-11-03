const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/testApp');

let t;
before(async () => {
  t = await startTestApp({ DEMO_MODE: 'false' });
});
after(() => t?.stop());

const htmlTag = (body) => body.match(/<html[^>]*>/)[0];

test('layout choice is kept server-side and sets the matching <html> attributes', async () => {
  const { LAYOUTS } = require('../src/utils/layouts');
  assert.equal(Object.keys(LAYOUTS).length, 14);
  let cookie;
  for (const [key, def] of Object.entries(LAYOUTS)) {
    const res = await t.request(`/layout/${key}?next=/events`, { cookie });
    assert.equal(res.status, 302);
    assert.equal(res.location, '/events');
    cookie = res.cookie || cookie;
    assert.ok(cookie && cookie.startsWith('zury.sid='), 'only the session cookie is used');
    const events = await t.request('/events', { cookie });
    const tag = htmlTag(events.body);
    for (const [attr, value] of Object.entries(def.html)) assert.match(tag, new RegExp(`${attr}="${value}"`), `${key}: ${attr}`);
    if (def.rtl) assert.match(events.body, /tabler\.rtl\.min\.css/);
    if (def.asideClass) assert.match(events.body, new RegExp(`navbar-vertical navbar-expand-lg ${def.asideClass}`));
  }
});

test('display options are stored server-side and rendered as classes', async () => {
  const res = await t.request('/preferences/display?wide=1&next=/events');
  assert.equal(res.location, '/events');
  const page = await t.request('/events', { cookie: res.cookie });
  assert.match(htmlTag(page.body), /class="zury-wide"/);
  assert.doesNotMatch(page.body, /localStorage/);
  const off = await t.request('/preferences/display?wide=0&textLarge=1&next=/events', { cookie: res.cookie });
  const page2 = await t.request('/events', { cookie: off.cookie || res.cookie });
  assert.match(htmlTag(page2.body), /class="zury-text-lg"/);
});

test('unknown layouts are ignored and redirects stay on site', async () => {
  const bad = await t.request('/layout/evil?next=//evil.example');
  assert.equal(bad.location, '/dashboard');
  const page = await t.request('/events');
  assert.equal(htmlTag(page.body), '<html lang="en" >', 'default layout');
});

test('the homepage always uses the two-row header', async () => {
  const set = await t.request('/layout/folded?next=/');
  const home = await t.request('/', { cookie: set.cookie });
  assert.equal(htmlTag(home.body), '<html lang="en" >');
});
