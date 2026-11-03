// Finds contributions for an event straight from the wikis:
// - participants: every edit by registered participants during the event,
// - hashtags: edits whose summary contains one of the event's hashtags
//   (recent changes only reach back about 30 days),
// - categories: pages added to one of the event's categories during the event.
const prisma = require('../config/prisma');
const wikiApi = require('../wiki/wikiApi');
const { effectiveFor } = require('../events/effective');

const SOURCES = { participant: 'Participants', hashtag: 'Hashtag', category: 'Category' };
const MAX_PAGES = 10;

const jsonList = (v) => {
  try {
    const list = JSON.parse(v || '[]');
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

// Follows the API's "continue" until done or MAX_PAGES requests.
async function* pages(wiki, params) {
  let cont = {};
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await wikiApi.get(wiki, { ...params, ...cont });
    yield data;
    if (!data.continue) return;
    cont = data.continue;
  }
}

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function rev(wiki, source, r, username) {
  return {
    wiki,
    key: `${wiki}:rev:${r.revid}`,
    source,
    username: username || r.user || '',
    pageTitle: r.title,
    ns: r.ns ?? 0,
    revId: r.revid,
    isNew: !!r.new || r.type === 'new',
    sizeDiff: r.sizediff ?? (r.newlen != null && r.oldlen != null ? r.newlen - r.oldlen : 0),
    comment: (r.comment || '').slice(0, 500),
    timestamp: new Date(r.timestamp),
  };
}

async function participantEdits(wiki, usernames, from, until) {
  const out = [];
  for (let i = 0; i < usernames.length; i += 50) {
    const params = {
      action: 'query', list: 'usercontribs', ucuser: usernames.slice(i, i + 50).join('|'),
      ucstart: iso(until), ucend: iso(from), ucprop: 'ids|title|timestamp|comment|sizediff|flags', uclimit: '500',
    };
    for await (const data of pages(wiki, params)) out.push(...(data.query?.usercontribs || []).map((r) => rev(wiki, 'participant', r)));
  }
  return out;
}

async function hashtagEdits(wiki, hashtags, from, until) {
  const tags = hashtags.map((h) => `#${h.replace(/^#/, '').toLowerCase()}`);
  const out = [];
  const params = {
    action: 'query', list: 'recentchanges', rcstart: iso(until), rcend: iso(from), rctype: 'edit|new',
    rcprop: 'user|comment|title|ids|timestamp|sizes|flags', rclimit: '500',
  };
  for await (const data of pages(wiki, params)) {
    for (const r of data.query?.recentchanges || []) {
      const comment = (r.comment || '').toLowerCase();
      if (tags.some((t) => new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(comment))) out.push(rev(wiki, 'hashtag', r));
    }
  }
  return out;
}

async function categoryPages(wiki, categories, from, until) {
  const out = [];
  for (const cat of categories) {
    const params = {
      action: 'query', list: 'categorymembers', cmtitle: `Category:${cat.replace(/^Category:/i, '')}`,
      cmprop: 'ids|title|timestamp', cmsort: 'timestamp', cmstart: iso(from), cmend: iso(until), cmlimit: '500',
    };
    for await (const data of pages(wiki, params)) {
      for (const p of data.query?.categorymembers || []) {
        out.push({ wiki, key: `${wiki}:page:${p.pageid}`, source: 'category', username: '', pageTitle: p.title, ns: p.ns ?? 0, revId: null, isNew: false, sizeDiff: 0, comment: `Category:${cat}`, timestamp: new Date(p.timestamp) });
      }
    }
  }
  return out;
}

function enabledFor(settings) {
  return {
    participants: !!settings.contributionDiscoveryEnabled,
    hashtags: jsonList(settings.trackHashtags),
    categories: jsonList(settings.trackCategories),
  };
}

const isTracking = (settings) => {
  const t = enabledFor(settings);
  return t.participants || t.hashtags.length > 0 || t.categories.length > 0;
};

/**
 * Looks for new contributions on every active wiki of the event, each with its
 * own settings and dates. Returns { added, errors: [message] }.
 */
async function refresh({ contest, settings, eventWikis = [], now = new Date() }) {
  const wikis = eventWikis.filter((w) => w.status === 'active');
  const parts = wikis.length ? wikis : [null];
  const found = [];
  const errors = [];
  const participants = await prisma.contestMembership.findMany({
    where: { contestId: contest.id, role: 'participant', status: 'active' },
    include: { user: { select: { username: true, isDemo: true } } },
  });

  for (const eventWiki of parts) {
    const eff = effectiveFor(contest, settings, eventWiki, now);
    const wiki = eventWiki ? eventWiki.wiki : contest.primaryWiki;
    const from = eff.contest.startDate;
    if (!from || from > now) continue;
    const until = eff.contest.endDate && eff.contest.endDate < now ? eff.contest.endDate : now;
    const t = enabledFor(eff.settings);
    const users = participants.filter((m) => !m.user.isDemo && (!m.wiki || m.wiki === wiki || parts.length === 1)).map((m) => m.user.username);
    const jobs = [
      t.participants && users.length && participantEdits(wiki, users, from, until),
      t.hashtags.length && hashtagEdits(wiki, t.hashtags, from, until),
      t.categories.length && categoryPages(wiki, t.categories, from, until),
    ].filter(Boolean);
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === 'fulfilled') found.push(...result.value);
      else errors.push(`${wiki}: ${result.reason.message}`);
    }
  }

  // A participant's edit that also carries the hashtag is kept once, as theirs.
  const byKey = new Map();
  for (const c of found) if (!byKey.has(c.key) || c.source === 'participant') byKey.set(c.key, c);
  const existing = new Set((await prisma.contribution.findMany({ where: { contestId: contest.id }, select: { key: true } })).map((c) => c.key));
  const fresh = [...byKey.values()].filter((c) => !existing.has(c.key));
  const names = [...new Set(fresh.map((c) => c.username).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true, username: true } });
  const idOf = Object.fromEntries(users.map((u) => [u.username, u.id]));
  if (fresh.length) {
    await prisma.contribution.createMany({ data: fresh.map((c) => ({ ...c, contestId: contest.id, userId: idOf[c.username] ?? null })) });
  }
  await prisma.contestSettings.updateMany({ where: { contestId: contest.id }, data: { trackedAt: now } });
  return { added: fresh.length, errors };
}

// Totals for the tracking page; wiki limits to one wiki of the event.
async function summary(contestId, { wiki } = {}) {
  const where = { contestId, ...(wiki && { wiki }) };
  const [totals, newPages, bySource, byWiki, byUser, recent] = await Promise.all([
    prisma.contribution.aggregate({ where, _count: { _all: true }, _sum: { sizeDiff: true } }),
    prisma.contribution.count({ where: { ...where, isNew: true } }),
    prisma.contribution.groupBy({ by: ['source'], where, _count: { _all: true } }),
    prisma.contribution.groupBy({ by: ['wiki'], where, _count: { _all: true }, _sum: { sizeDiff: true } }),
    prisma.contribution.groupBy({ by: ['username'], where: { ...where, username: { not: '' } }, _count: { _all: true }, _sum: { sizeDiff: true }, orderBy: { _count: { username: 'desc' } }, take: 15 }),
    prisma.contribution.findMany({ where, orderBy: { timestamp: 'desc' }, take: 100 }),
  ]);
  return {
    total: totals._count._all,
    bytes: totals._sum.sizeDiff || 0,
    newPages,
    contributors: (await prisma.contribution.groupBy({ by: ['username'], where: { ...where, username: { not: '' } } })).length,
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
    byWiki: byWiki.map((r) => ({ wiki: r.wiki, count: r._count._all, bytes: r._sum.sizeDiff || 0 })).sort((a, b) => b.count - a.count),
    byUser: byUser.map((r) => ({ username: r.username, count: r._count._all, bytes: r._sum.sizeDiff || 0 })),
    recent,
  };
}

module.exports = { SOURCES, jsonList, enabledFor, isTracking, refresh, summary };
