const env = require('../config/env');
const { dbnameToHost } = require('./wikiUrls');

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

class WikiApiError extends Error {}

function apiUrl(wiki) {
  if (env.wikimedia.apiUrlTemplate) return env.wikimedia.apiUrlTemplate.replace('{wiki}', wiki);
  const host = dbnameToHost(wiki);
  if (!host) throw new WikiApiError(`Unknown wiki "${wiki}".`);
  return `https://${host}/w/api.php`;
}

// GET against the MediaWiki Action API. Responses are cached briefly so a
// preview followed by a confirm doesn't hit the wiki twice.
async function get(wiki, params) {
  const url = new URL(apiUrl(wiki));
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params }).toString();
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': env.userAgent }, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new WikiApiError(`Could not reach ${wiki}: ${err.message}`);
  }
  if (!response.ok) throw new WikiApiError(`${wiki} returned HTTP ${response.status}.`);
  const data = await response.json();
  if (data.error) throw new WikiApiError(`${wiki} API error: ${data.error.info || data.error.code}`);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

function clearCache() {
  cache.clear();
}

module.exports = { WikiApiError, get, apiUrl, clearCache };
