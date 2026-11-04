const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/testApp');

let t;

before(async () => {
  t = await startTestApp();
});

after(async () => {
  await t?.stop();
});

test('production refuses weak or missing settings', () => {
  const { productionProblems } = require('../src/config/env');
  const good = {
    SESSION_SECRET: 'x'.repeat(40),
    WIKIMEDIA_CONSUMER_KEY: 'key',
    WIKIMEDIA_CONSUMER_SECRET: 'secret',
    WIKIMEDIA_CALLBACK_URL: 'https://zury.toolforge.org/',
    DATABASE_URL: 'file:./zury.db',
  };
  assert.deepEqual(productionProblems(good), []);
  assert.equal(productionProblems({ ...good, SESSION_SECRET: 'short' }).length, 1);
  assert.equal(productionProblems({ ...good, SESSION_SECRET: 'replace_with_secure_random_value_padding' }).length, 1);
  assert.equal(productionProblems({ ...good, WIKIMEDIA_CONSUMER_KEY: 'your_consumer_key' }).length, 1);
  assert.equal(productionProblems({ ...good, WIKIMEDIA_CALLBACK_URL: 'http://zury.toolforge.org/' }).length, 1);
  assert.equal(productionProblems({ ...good, WIKIMEDIA_API_URL_TEMPLATE: 'http://x/{wiki}' }).length, 1);
});

test('pages carry security headers and the health check answers', async () => {
  const res = await fetch(`${t.baseUrl}/`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/, 'no inline scripts');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.doesNotMatch(await res.text(), /\son(click|change|submit|load)=/i, 'no inline event handlers');

  const health = await fetch(`${t.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('sessions are stored in the database and expire', async () => {
  const { PrismaSessionStore } = require('../src/config/sessionStore');
  const store = new PrismaSessionStore({ prune: false });
  const call = (fn, ...args) => new Promise((resolve, reject) => store[fn](...args, (err, v) => (err ? reject(err) : resolve(v))));
  const future = new Date(Date.now() + 60000).toISOString();
  await call('set', 'abc', { cookie: { expires: future }, userId: 7 });
  assert.equal((await call('get', 'abc')).userId, 7);
  await call('set', 'old', { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, userId: 8 });
  assert.equal(await call('get', 'old'), null, 'expired sessions are not returned');
  assert.equal(await store.prune(), 1);
  await call('destroy', 'abc');
  assert.equal(await call('get', 'abc'), null);
});

test('rate limits answer 429 once the limit is passed', async () => {
  const { rateLimit } = require('../src/middleware/security');
  const limit = rateLimit({ windowMs: 60000, max: 2, inTests: true });
  const run = () => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json() { return this; }, render() { return this; } };
    let passed = false;
    limit({ ip: '1.2.3.4', method: 'GET', path: '/api/x' }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run().passed, true);
  assert.equal(run().passed, true);
  const third = run();
  assert.equal(third.passed, false);
  assert.equal(third.res.statusCode, 429);
  assert.ok(Number(third.res.headers['Retry-After']) > 0);
});

test('search engines: descriptions, canonical links, noindex on staff pages, robots.txt and sitemap.xml', async () => {
  const { startTestApp } = require('./helpers/testApp');
  const app = await startTestApp({ DEMO_MODE: 'true' });
  try {
    await require('./helpers/fixtures').seedDemoData(app.prisma);
    const home = await app.request('/events');
    assert.match(home.body, /<meta name="description" content="[^"]{20,}">/);
    assert.match(home.body, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/events">/);
    assert.match(home.body, /property="og:title"/);
    const event = await app.request('/wam/2026');
    assert.match(event.body, /<meta name="description" content="Write or expand articles about Asia/);
    assert.match((await app.request('/demo')).body, /noindex/, 'staff and personal pages stay out of search');
    const robots = await app.request('/robots.txt');
    assert.match(robots.body, /Disallow: \/admin/);
    assert.match(robots.body, /Sitemap: /);
    const map = await app.request('/sitemap.xml');
    assert.match(map.body, /<urlset/);
    assert.match(map.body, /\/wam\/2026<\/loc>/);
    assert.doesNotMatch(map.body, /jury-calibration/, 'no private events');
  } finally {
    app.stop();
  }
});
