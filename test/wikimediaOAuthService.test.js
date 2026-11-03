const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createMockWikimedia } = require('./helpers/mockWikimedia');

const CONSUMER_KEY = 'testconsumerkey';
const CONSUMER_SECRET = 'testconsumersecret';
const USER = {
  wikimediaId: 4242,
  username: 'Test User',
  homeWiki: 'bnwiki',
  registered: '20130503042305',
  registration: '2013-05-03T04:23:05Z',
  editCount: 1234,
  globalGroups: ['steward', 'global-rollbacker'],
  localGroups: [{ wiki: 'bnwiki', groups: ['sysop', 'bureaucrat'] }],
};

const mock = createMockWikimedia({ consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET, user: USER });
let oauth;
let baseUrl;

before(async () => {
  baseUrl = await mock.start();
  Object.assign(process.env, {
    SESSION_SECRET: 'test',
    WIKIMEDIA_CONSUMER_KEY: CONSUMER_KEY,
    WIKIMEDIA_CONSUMER_SECRET: CONSUMER_SECRET,
    WIKIMEDIA_CALLBACK_URL: 'http://127.0.0.1:5000/',
    WIKIMEDIA_OAUTH_BASE_URL: baseUrl,
  });
  oauth = require('../src/services/wikimediaOAuthService');
});

after(() => mock.stop());

test('full handshake: initiate, authorize, token, identify', async () => {
  const requestToken = await oauth.getRequestToken();
  const initiate = mock.log.find((e) => e.step === 'initiate');
  assert.equal(initiate.error, undefined, 'initiate signature must verify');
  assert.equal(initiate.allParams.oauth_callback, 'oob', 'returns to the registered callback');
  assert.match(initiate.userAgent, /^Zury\//);

  const authorizeUrl = new URL(oauth.getAuthorizeUrl(requestToken.key));
  assert.equal(authorizeUrl.pathname, '/wiki/Special:OAuth/authorize');
  assert.equal(authorizeUrl.searchParams.get('oauth_token'), requestToken.key);
  assert.equal(authorizeUrl.searchParams.get('oauth_consumer_key'), CONSUMER_KEY);

  const { verifier } = mock.approve(requestToken.key);
  const accessToken = await oauth.getAccessToken(requestToken, verifier);
  assert.equal(mock.log.find((e) => e.step === 'token').error, undefined);

  const identity = await oauth.identify(accessToken);
  assert.deepEqual(identity, {
    wikimediaId: 4242,
    username: 'Test User',
    registeredAt: new Date('2013-05-03T04:23:05Z'),
  });
});

test('globaluserinfo lookup by central ID returns home wiki and groups', async () => {
  const api = require('../src/services/wikimediaApiService');
  const info = await api.fetchGlobalUserInfo(4242);
  assert.deepEqual(info, {
    id: 4242,
    name: 'Test User',
    registeredAt: new Date('2013-05-03T04:23:05Z'),
    editCount: 1234,
    home: 'bnwiki',
    globalGroups: ['steward', 'global-rollbacker'],
    localGroups: [{ wiki: 'bnwiki', groups: ['sysop', 'bureaucrat'] }],
  });
  const call = mock.log.findLast((e) => e.step === 'globaluserinfo');
  assert.equal(call.params.guiprop, 'groups|merged|editcount');
  assert.match(call.userAgent, /^Zury\//);

  assert.equal(await api.fetchGlobalUserInfo(1), null, 'unknown account');
  mock.apiDown = true;
  assert.equal(await api.fetchGlobalUserInfo(4242), null, 'API outage');
  mock.apiDown = false;

  const { extractTrackedRights } = require('../src/services/rightsService');
  assert.deepEqual(extractTrackedRights(info), [
    { wiki: '*', rightName: 'steward' },
    { wiki: 'bnwiki', rightName: 'sysop' },
  ]);
});

test('token exchange fails with a wrong verifier', async () => {
  const requestToken = await oauth.getRequestToken();
  mock.approve(requestToken.key);
  await assert.rejects(oauth.getAccessToken(requestToken, 'wrong'), oauth.WikimediaOAuthError);
});

test('token exchange fails when signed with the wrong token secret', async () => {
  const requestToken = await oauth.getRequestToken();
  const { verifier } = mock.approve(requestToken.key);
  await assert.rejects(
    oauth.getAccessToken({ key: requestToken.key, secret: 'forged' }, verifier),
    /mwoauth-invalid-signature/,
  );
});

test('identify token verification rejects tampering', () => {
  const issuer = new URL(baseUrl).origin;
  const sign = (claims, secret = CONSUMER_SECRET, opts = {}) =>
    jwt.sign({ iss: issuer, aud: CONSUMER_KEY, sub: 1, username: 'A', nonce: 'n', ...claims }, secret, {
      algorithm: 'HS256',
      expiresIn: 100,
      ...opts,
    });

  assert.equal(oauth.verifyIdentityToken(sign({}), 'n').username, 'A');
  assert.throws(() => oauth.verifyIdentityToken(sign({}, 'other-secret'), 'n'), /invalid signature/);
  assert.throws(() => oauth.verifyIdentityToken(sign({ aud: 'someone-else' }), 'n'), /audience/);
  assert.throws(() => oauth.verifyIdentityToken(sign({ iss: 'https://evil.example' }), 'n'), /issuer/);
  assert.throws(() => oauth.verifyIdentityToken(sign({}), 'different-nonce'), /nonce/);
  assert.throws(() => oauth.verifyIdentityToken(sign({}, CONSUMER_SECRET, { expiresIn: -120 }), 'n'), /expired/);
  assert.throws(() => oauth.verifyIdentityToken(sign({ sub: 'abc' }), 'n'), /missing user identity/);
  const unsigned = jwt.sign({ iss: issuer, aud: CONSUMER_KEY, sub: 1, username: 'A', nonce: 'n' }, null, { algorithm: 'none' });
  assert.throws(() => oauth.verifyIdentityToken(unsigned, 'n'));
});

test('parseMediaWikiTimestamp', () => {
  assert.deepEqual(oauth.parseMediaWikiTimestamp('20130503042305'), new Date('2013-05-03T04:23:05Z'));
  assert.equal(oauth.parseMediaWikiTimestamp(undefined), null);
  assert.equal(oauth.parseMediaWikiTimestamp('2013-05-03'), null);
});
