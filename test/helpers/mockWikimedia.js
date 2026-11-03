// A stand-in for Special:OAuth on a MediaWiki wiki. It verifies OAuth 1.0a
// HMAC-SHA1 signatures independently of the oauth-1.0a library (RFC 5849).
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function parseAuthHeader(header) {
  const params = {};
  if (!header || !header.startsWith('OAuth ')) return params;
  for (const [, key, value] of header.matchAll(/([\w]+)="([^"]*)"/g)) {
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return params;
}

function expectedSignature(method, baseUrl, params, consumerSecret, tokenSecret = '') {
  const paramString = Object.entries(params)
    .filter(([k]) => k !== 'oauth_signature' && k !== 'realm')
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(paramString)].join('&');
  return crypto.createHmac('sha1', `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`).update(base).digest('base64');
}

function createMockWikimedia({ consumerKey, consumerSecret, user }) {
  const requestTokens = new Map();
  const accessTokens = new Map();
  const log = [];
  let origin;

  function verify(req, url, tokenStore) {
    const oauthParams = parseAuthHeader(req.headers.authorization);
    const allParams = { ...Object.fromEntries(url.searchParams), ...oauthParams };
    if (oauthParams.oauth_consumer_key !== consumerKey) return { error: 'mwoauth-invalid-consumer' };

    let tokenSecret = '';
    if (tokenStore) {
      const entry = tokenStore.get(oauthParams.oauth_token);
      if (!entry) return { error: 'mwoauth-invalid-token' };
      tokenSecret = entry.secret;
    }
    const expected = expectedSignature(req.method, `${origin}${url.pathname}`, allParams, consumerSecret, tokenSecret);
    if (expected !== oauthParams.oauth_signature) return { error: 'mwoauth-invalid-signature' };
    return { oauthParams, allParams };
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    const title = url.searchParams.get('title');
    const send = (status, body, type = 'text/plain') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };

    if (url.pathname === '/w/api.php') {
      log.push({ step: 'globaluserinfo', userAgent: req.headers['user-agent'], params: Object.fromEntries(url.searchParams) });
      if (mock.apiDown) return send(503, 'Service Unavailable');
      const found = url.searchParams.get('guiid') === String(user.wikimediaId);
      const info = found
        ? {
            id: user.wikimediaId,
            name: user.username,
            home: user.homeWiki,
            groups: user.globalGroups || [],
            merged: [
              { wiki: user.homeWiki, url: 'https://example.org' },
              ...(user.localGroups || []).map((g) => ({ wiki: g.wiki, url: 'https://example.org', groups: g.groups })),
            ],
          }
        : { missing: true };
      return send(200, JSON.stringify({ batchcomplete: true, query: { globaluserinfo: info } }), 'application/json');
    }

    if (req.method === 'GET' && url.pathname === '/wiki/Special:OAuth/authorize') {
      const entry = requestTokens.get(url.searchParams.get('oauth_token'));
      if (!entry) return send(400, 'Error: mwoauth-invalid-token');
      entry.verifier = crypto.randomBytes(8).toString('hex');
      const callback = new URL(entry.callback);
      callback.searchParams.set('oauth_token', url.searchParams.get('oauth_token'));
      callback.searchParams.set('oauth_verifier', entry.verifier);
      res.writeHead(302, { Location: callback.toString() });
      return res.end();
    }

    if (req.method !== 'POST' || url.pathname !== '/w/index.php') return send(404, 'not found');

    if (title === 'Special:OAuth/initiate') {
      const result = verify(req, url);
      log.push({ step: 'initiate', ...result, userAgent: req.headers['user-agent'] });
      if (result.error) return send(400, `Error: ${result.error}`);
      const key = crypto.randomBytes(8).toString('hex');
      requestTokens.set(key, { secret: crypto.randomBytes(8).toString('hex'), callback: result.allParams.oauth_callback });
      return send(200, `oauth_token=${key}&oauth_token_secret=${requestTokens.get(key).secret}&oauth_callback_confirmed=true`);
    }

    if (title === 'Special:OAuth/token') {
      const result = verify(req, url, requestTokens);
      log.push({ step: 'token', ...result });
      if (result.error) return send(400, `Error: ${result.error}`);
      const entry = requestTokens.get(result.oauthParams.oauth_token);
      if (!entry.verifier || entry.verifier !== result.allParams.oauth_verifier) return send(400, 'Error: mwoauth-verification-failed');
      requestTokens.delete(result.oauthParams.oauth_token);
      const key = crypto.randomBytes(8).toString('hex');
      accessTokens.set(key, { secret: crypto.randomBytes(8).toString('hex') });
      return send(200, `oauth_token=${key}&oauth_token_secret=${accessTokens.get(key).secret}`);
    }

    if (title === 'Special:OAuth/identify') {
      const result = verify(req, url, accessTokens);
      log.push({ step: 'identify', ...result });
      if (result.error) return send(400, `Error: ${result.error}`);
      const token = jwt.sign(
        {
          iss: origin,
          sub: user.wikimediaId,
          aud: consumerKey,
          username: user.username,
          registered: user.registered,
          nonce: result.oauthParams.oauth_nonce,
        },
        consumerSecret,
        { algorithm: 'HS256', expiresIn: 100 },
      );
      return send(200, token, 'application/jwt');
    }

    send(404, 'unknown special page');
  });

  const mock = {
    log,
    apiDown: false,
    // Simulates the user clicking "Allow" on Special:OAuth/authorize.
    approve(requestKey) {
      const entry = requestTokens.get(requestKey);
      if (!entry) throw new Error('unknown request token');
      entry.verifier = crypto.randomBytes(8).toString('hex');
      return { verifier: entry.verifier, callback: entry.callback };
    },
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      origin = `http://127.0.0.1:${server.address().port}`;
      return `${origin}/w/index.php`;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
  return mock;
}

module.exports = { createMockWikimedia };
