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
