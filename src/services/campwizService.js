// Tracking a CampWiz campaign (Wiki Loves Folklore and others) without copying anything.
// CampWiz itself only shares its public campaign list; submissions need its login. Every entry is a
// file in the campaign's Commons category, so the numbers come from Commons: files, uploaders, top
// uploaders. Kept 30 minutes in memory.
const wikiApi = require('../wiki/wikiApi');

class CampwizError extends Error {}

// "https://campwiz.toolforge.org/campaign/c3al44zifal1c", ".../campaign/243", or just the id.
function campaignId(url) {
  const s = String(url || '').trim();
  const m = s.match(/campaign\/([A-Za-z0-9_-]+)/) || s.match(/^([A-Za-z0-9_-]{2,40})$/);
  return m ? m[1] : '';
}
const categoryName = (c) => String(c || '').trim().replace(/^https?:\/\/[^/]+\/wiki\//, '').replace(/^(Category|বিষয়শ্রেণী|বিষয়শ্রেণি):/i, '').replace(/_/g, ' ').trim();

const kept = new Map();
async function publicCampaign(id) {
  if (!id) return null;
  const r = await fetch('https://campwiz.toolforge.org/api/v2/campaign/?limit=1000', { headers: { 'User-Agent': require('../config/env').userAgent }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  const c = j && (j.data || []).find((x) => x.campaignId === id);
  return c ? { name: (c.name || '').trim(), status: c.status, start: c.startDate, end: c.endDate, type: c.campaignType } : null;
}

async function commonsNumbers(category) {
  const ci = await wikiApi.get('commonswiki', { action: 'query', prop: 'categoryinfo', titles: 'Category:' + category });
  const page = ci.query && ci.query.pages && ci.query.pages[0];
  if (!page || page.missing) throw new CampwizError('That Commons category was not found.');
  const files = (page.categoryinfo && page.categoryinfo.files) || 0;
  // Uploaders: the first 5,000 files are read (enough for the top uploaders of most campaigns).
  const by = new Map(); let seen = 0; let cont = {};
  for (let i = 0; i < 10; i += 1) {
    const d = await wikiApi.get('commonswiki', { action: 'query', generator: 'categorymembers', gcmtitle: 'Category:' + category, gcmtype: 'file', gcmlimit: '500', prop: 'imageinfo', iiprop: 'user', ...cont });
    for (const p of (d.query && d.query.pages) || []) { const u = p.imageinfo && p.imageinfo[0] && p.imageinfo[0].user; if (u) { by.set(u, (by.get(u) || 0) + 1); seen += 1; } }
    if (!d.continue) break;
    cont = d.continue;
  }
  return { files, uploaders: by.size, partial: seen < files, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([user, n]) => ({ user, files: n })) };
}

async function tracked({ url, category }) {
  const key = url + '|' + category;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < 1800000) return hit.data;
  const id = campaignId(url);
  const [info, nums] = await Promise.all([publicCampaign(id).catch(() => null), category ? commonsNumbers(categoryName(category)) : null]);
  const data = { url, id, category: categoryName(category), info, ...(nums || {}), readAt: new Date() };
  kept.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { tracked, campaignId, categoryName, CampwizError };
