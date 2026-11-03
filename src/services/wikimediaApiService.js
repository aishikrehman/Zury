const env = require('../config/env');

const metaApiUrl = () => env.wikimedia.oauthBaseUrl.replace(/index\.php$/, 'api.php');

async function apiGet(params) {
  const url = new URL(metaApiUrl());
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const response = await fetch(url, {
    headers: { 'User-Agent': env.userAgent },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`MediaWiki API HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`MediaWiki API error: ${data.error.code}`);
  return data;
}

// Returns null when the account can't be looked up; callers must then keep
// whatever was verified before rather than treat the user as having no rights.
async function fetchGlobalUserInfo(centralId) {
  try {
    const data = await apiGet({
      action: 'query',
      meta: 'globaluserinfo',
      guiid: String(centralId),
      guiprop: 'groups|merged',
    });
    const info = data?.query?.globaluserinfo;
    if (!info || info.missing || Number(info.id) !== Number(centralId)) return null;
    return {
      home: typeof info.home === 'string' ? info.home : null,
      globalGroups: Array.isArray(info.groups) ? info.groups : [],
      localGroups: (Array.isArray(info.merged) ? info.merged : [])
        .filter((m) => typeof m.wiki === 'string' && Array.isArray(m.groups) && m.groups.length)
        .map((m) => ({ wiki: m.wiki, groups: m.groups })),
    };
  } catch (err) {
    console.error(`globaluserinfo lookup failed for central ID ${centralId}: ${err.message}`);
    return null;
  }
}

module.exports = { fetchGlobalUserInfo };
