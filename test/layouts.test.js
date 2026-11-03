const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/testApp');

let t;
before(async () => {
  t = await startTestApp({ DEMO_MODE: 'false' });
});
after(() => t?.stop());

const htmlTag = (body) => body.match(/<html[^>]*>/)[0];

test('every layout switch sets a cookie and the matching <html> attributes', async () => {
  const { LAYOUTS } = require('../src/utils/layouts');
  assert.equal(Object.keys(LAYOUTS).length, 14);
  for (const [key, def] of Object.entries(LAYOUTS)) {
    const res = await t.request(`/layout/${key}?next=/events`);
    assert.equal(res.status, 302);
    assert.equal(res.location, '/events');
    const events = await t.request('/events', { cookie: `zury_layout=${key}` });
    const tag = htmlTag(events.body);
    for (const [attr, value] of Object.entries(def.html)) assert.match(tag, new RegExp(`${attr}="${value}"`), `${key}: ${attr}`);
    if (def.rtl) assert.match(events.body, /tabler\.rtl\.min\.css/);
    if (def.asideClass) assert.match(events.body, new RegExp(`navbar-vertical navbar-expand-lg ${def.asideClass}`));
  }
});

test('unknown layouts are ignored and redirects stay on site', async () => {
  const bad = await t.request('/layout/evil?next=//evil.example');
  assert.equal(bad.location, '/dashboard');
  const page = await t.request('/events', { cookie: 'zury_layout=evil"><script>' });
  assert.equal(htmlTag(page.body), '<html lang="en" >', 'falls back to the default');
});

test('the homepage always uses the two-row header without a sidebar', async () => {
  const home = await t.request('/', { cookie: 'zury_layout=folded' });
  assert.equal(htmlTag(home.body), '<html lang="en" >');
});
