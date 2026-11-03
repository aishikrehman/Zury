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

function normalize(info) {
  const registration = info.registration ? new Date(info.registration) : null;
  return {
    id: Number(info.id),
    name: info.name,
    home: typeof info.home === 'string' ? info.home : null,
    registeredAt: registration && !Number.isNaN(registration.getTime()) ? registration : null,
    editCount: Number.isInteger(info.editcount) ? info.editcount : null,
    globalGroups: Array.isArray(info.groups) ? info.groups : [],
    localGroups: (Array.isArray(info.merged) ? info.merged : [])
      .filter((m) => typeof m.wiki === 'string' && Array.isArray(m.groups) && m.groups.length)
      .map((m) => ({ wiki: m.wiki, groups: m.groups })),
  };
}

// Returns null when the account can't be looked up; callers must then keep
// whatever was verified before rather than treat the user as having no rights.
async function lookup(params, label) {
  try {
    const data = await apiGet({ action: 'query', meta: 'globaluserinfo', guiprop: 'groups|merged|editcount', ...params });
    const info = data?.query?.globaluserinfo;
    if (!info || info.missing || !Number.isInteger(Number(info.id)) || !info.name) return null;
    return normalize(info);
  } catch (err) {
    console.error(`globaluserinfo lookup failed for ${label}: ${err.message}`);
    return null;
  }
}

async function fetchGlobalUserInfo(centralId) {
  const info = await lookup({ guiid: String(centralId) }, `central ID ${centralId}`);
  return info && info.id === Number(centralId) ? info : null;
}

function fetchGlobalUserInfoByName(username) {
  return lookup({ guiuser: username }, `"${username}"`);
}

module.exports = { fetchGlobalUserInfo, fetchGlobalUserInfoByName };
