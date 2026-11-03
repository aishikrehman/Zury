const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const { consumerKey, consumerSecret, callbackUrl, oauthBaseUrl } = env.wikimedia;

const oauth = OAuth({
  consumer: { key: consumerKey || '', secret: consumerSecret || '' },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  },
});

class WikimediaOAuthError extends Error {}

function assertConfigured() {
  const placeholder = (v) => !v || v.startsWith('your_');
  if (placeholder(consumerKey) || placeholder(consumerSecret) || !callbackUrl) {
    throw new WikimediaOAuthError(
      'Wikimedia OAuth is not configured. Set WIKIMEDIA_CONSUMER_KEY, WIKIMEDIA_CONSUMER_SECRET and WIKIMEDIA_CALLBACK_URL in .env.',
    );
  }
}

// "oob" tells MediaWiki to send the user back to the consumer's registered
// callback URL (WIKIMEDIA_CALLBACK_URL). This works whether or not the
// consumer allows callback overrides; Zury handles the return on that URL.
const OAUTH_CALLBACK = 'oob';

function specialPageUrl(page, params = {}) {
  const url = new URL(oauthBaseUrl);
  url.searchParams.set('title', `Special:OAuth/${page}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// Parameters are carried in the URL query so oauth-1.0a includes them in the
// signature base string and MediaWiki receives them as request parameters.
async function signedPost(url, token) {
  const oauthData = oauth.authorize({ url, method: 'POST' }, token);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...oauth.toHeader(oauthData), 'User-Agent': env.userAgent },
    signal: AbortSignal.timeout(15000),
  });
  return { text: (await response.text()).trim(), nonce: oauthData.oauth_nonce };
}

// Meta-Wiki answers in JSON when format=json is sent; plain OAuth servers use form encoding.
function parseCredentials(text, step) {
  let params;
  try {
    const json = JSON.parse(text);
    if (json.error) throw new WikimediaOAuthError(`Wikimedia OAuth ${step} failed: ${json.message || json.error}`);
    params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  } catch (err) {
    if (err instanceof WikimediaOAuthError) throw err;
    params = new URLSearchParams(text);
  }
  const key = params.get('oauth_token');
  const secret = params.get('oauth_token_secret');
  if (!key || !secret) {
    throw new WikimediaOAuthError(`Wikimedia OAuth ${step} failed: ${text.slice(0, 300)}`);
  }
  return { key, secret, params };
}

async function getRequestToken() {
  assertConfigured();
  const url = specialPageUrl('initiate', { format: 'json', oauth_callback: OAUTH_CALLBACK });
  const { text } = await signedPost(url);
  const { key, secret, params } = parseCredentials(text, 'initiate');
  if (params.get('oauth_callback_confirmed') !== 'true') {
    throw new WikimediaOAuthError('Wikimedia OAuth initiate failed: callback was not confirmed.');
  }
  return { key, secret };
}

// Special:OAuth/authorize is reached via /wiki/ rather than index.php, which
// avoids a known redirect problem on mobile domains.
function getAuthorizeUrl(requestTokenKey) {
  const url = new URL(oauthBaseUrl);
  url.pathname = '/wiki/Special:OAuth/authorize';
  url.search = '';
  url.searchParams.set('oauth_token', requestTokenKey);
  url.searchParams.set('oauth_consumer_key', consumerKey);
  return url.toString();
}

async function getAccessToken(requestToken, verifier) {
  assertConfigured();
  const url = specialPageUrl('token', { format: 'json', oauth_verifier: verifier });
  const { text } = await signedPost(url, requestToken);
  const { key, secret } = parseCredentials(text, 'token');
  return { key, secret };
}

// MediaWiki timestamps look like 20130503042305.
function parseMediaWikiTimestamp(ts) {
  if (typeof ts !== 'string' || !/^\d{14}$/.test(ts)) return null;
  const date = new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function verifyIdentityToken(token, expectedNonce) {
  let claims;
  try {
    claims = jwt.verify(token, consumerSecret, {
      algorithms: ['HS256'],
      audience: consumerKey,
      clockTolerance: 60,
    });
  } catch (err) {
    throw new WikimediaOAuthError(`Wikimedia OAuth identify failed: ${err.message}`);
  }

  if (new URL(claims.iss).host !== new URL(oauthBaseUrl).host) {
    throw new WikimediaOAuthError('Wikimedia OAuth identify failed: unexpected issuer.');
  }
  if (claims.nonce !== expectedNonce) {
    throw new WikimediaOAuthError('Wikimedia OAuth identify failed: nonce mismatch.');
  }

  const wikimediaId = Number.parseInt(claims.sub, 10);
  if (!Number.isInteger(wikimediaId) || !claims.username) {
    throw new WikimediaOAuthError('Wikimedia OAuth identify failed: missing user identity.');
  }

  return {
    wikimediaId,
    username: claims.username,
    registeredAt: parseMediaWikiTimestamp(claims.registered),
  };
}

async function identify(accessToken) {
  assertConfigured();
  const { text, nonce } = await signedPost(specialPageUrl('identify'), accessToken);
  return verifyIdentityToken(text, nonce);
}

// Calls a wiki's Action API as the logged-in person (their OAuth access token).
async function userApi(wiki, accessToken, params, { post = false } = {}) {
  const { apiUrl } = require('../wiki/wikiApi');
  const data = { format: 'json', formatversion: '2', ...params };
  const url = apiUrl(wiki);
  const request = post ? { url, method: 'POST', data } : { url: `${url}?${new URLSearchParams(data)}`, method: 'GET' };
  const headers = { ...oauth.toHeader(oauth.authorize(request, accessToken)), 'User-Agent': env.userAgent };
  const response = await fetch(request.url, {
    method: request.method,
    headers: post ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } : headers,
    body: post ? new URLSearchParams(data).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new WikimediaOAuthError(`${wiki} returned HTTP ${response.status}.`);
  return response.json();
}

module.exports = {
  WikimediaOAuthError,
  userApi,
  getRequestToken,
  getAuthorizeUrl,
  getAccessToken,
  identify,
  verifyIdentityToken,
  parseMediaWikiTimestamp,
};
