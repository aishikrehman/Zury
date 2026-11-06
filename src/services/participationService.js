// How people take part in an event, and which articles may be submitted.
//
// settings.participation (JSON):
//   mode      submit   — a first entry makes someone a participant (no join button)
//             register — they join on Zury first
//             onwiki   — those who signed up on an on-wiki page
//             list     — a fixed list of usernames, added as participants
//   ask       details asked when joining: email, legalName, phone (none: just the username)
//   page      the on-wiki page (sign-up page for onwiki; else where participants list themselves)
//   users     the fixed list (mode list)
//   outsiders others may join too (modes onwiki and list)
//   eligible  { source: none|page|list|category|wikidata, value, depth }
const prisma = require('../config/prisma');
const wikiApi = require('../wiki/wikiApi');
const { dbnameToHost } = require('../wiki/wikiUrls');
const env = require('../config/env');

const MODES = {
  submit: 'A first entry makes someone a participant',
  register: 'Participants join on Zury first',
  onwiki: 'Those who signed up on an on-wiki page',
  list: 'A fixed list of participants',
};
const ASK = { email: 'Email', phone: 'Phone', legalName: 'Legal name', nameEn: 'Name in English' };
// The event's rules set on the Review tab (kept with participation).
const RULES = {
  maxReviews: null, onBehalf: 'staff', mass: 'anyone', bulk: 'reviewers', stats: 'reviewers', appeals: 'off', withdraw: 'participant', editors: 'organizers', results: 'always', reviewerNames: 'yes',
};
const SOURCES = {
  none: 'Any article',
  page: 'Articles linked from an on-wiki page',
  list: 'A pasted list of articles',
  category: 'Articles in a category',
  wikidata: 'A Wikidata query',
};
const MAX_TITLES = 20000;

function read(settings) {
  let p = {};
  try {
    p = JSON.parse(settings?.participation || '{}') || {};
  } catch {
    p = {};
  }
  const mode = MODES[p.mode] ? p.mode : settings?.registrationRequired ? 'register' : 'submit';
  const e = p.eligible || {};
  return {
    mode,
    who: mode === 'list' ? 'members' : 'anyone',
    reg: mode === 'register' ? 'required' : 'auto',
    regWindow: p.regWindow === 'event' ? 'event' : 'any',
    createdAfter: p.createdAfter || '',
    createdBefore: p.createdBefore || '',
    group: p.group || '',
    rules: { ...RULES, ...(p.rules || {}) },
    ask: (Array.isArray(p.ask) ? p.ask : []).filter((k) => ASK[k]),
    page: String(p.page || ''),
    users: Array.isArray(p.users) ? p.users : [],
    outsiders: !!p.outsiders,
    eligible: { source: SOURCES[e.source] ? e.source : 'none', value: String(e.value || ''), depth: Math.min(Math.max(Number(e.depth) || 0, 0), 5) },
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lines = (v) => str(v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

// From the settings form. Also sets the older registration switches the rest of Zury reads.
function parse(body, errors) {
  // The form's choices: anyone or chosen members; registration automatic or required first.
  const mode = body.participation_who === 'members' ? 'list' : body.participation_reg === 'required' ? 'register' : body.participation_who ? 'submit' : MODES[body.participation_mode] ? body.participation_mode : 'submit';
  const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
  const ruleIn = (k, list) => (list.includes(body['rule_' + k]) ? body['rule_' + k] : RULES[k]);
  const maxRev = Number.parseInt(body.rule_maxReviews, 10);
  const rules = {
    maxReviews: Number.isInteger(maxRev) && maxRev > 0 ? maxRev : null,
    onBehalf: ruleIn('onBehalf', ['off', 'staff', 'anyone']),
    mass: ruleIn('mass', ['off', 'anyone', 'reviewers']),
    bulk: ruleIn('bulk', ['off', 'reviewers']),
    stats: ruleIn('stats', ['off', 'anyone', 'reviewers', 'organizers']),
    appeals: ruleIn('appeals', ['off', 'rejected', 'any']),
    withdraw: ruleIn('withdraw', ['off', 'reviewers', 'participant', 'both']),
    editors: ruleIn('editors', ['organizers', 'staff']),
    results: ruleIn('results', ['always', 'afterReview', 'manual']),
    reviewerNames: ruleIn('reviewerNames', ['yes', 'no']),
  };
  const ask = [].concat(body.participation_ask || []).filter((k) => ASK[k]);
  const page = str(body.participation_page).replace(/_/g, ' ').slice(0, 255);
  const users = [...new Set(lines(body.participation_users).map((u) => u.replace(/^(User|ব্যবহারকারী):/i, '').replace(/_/g, ' ').trim()).filter(Boolean))];
  if (mode === 'onwiki' && !page) errors.participation_page = 'Enter the on-wiki sign-up page.';
  if (body.eligible_source === 'page' && !String(body.eligible_value || '').trim()) errors.eligible_value = 'Enter the wiki page that lists the articles.';
  if (mode === 'list' && !users.length) errors.participation_users = 'Enter at least one username.';
  if (users.length > 5000) errors.participation_users = 'At most 5000 usernames.';
  const source = SOURCES[body.eligible_source] ? body.eligible_source : 'none';
  const value = str(body.eligible_value).slice(0, 200000);
  if (source !== 'none' && !value) errors.eligible_value = 'Enter where the articles come from.';
  const participation = {
    mode, ask, page, users, outsiders: body.participation_outsiders === 'on',
    regWindow: body.participation_regWindow === 'event' ? 'event' : 'any',
    createdAfter: day(body.participation_createdAfter), createdBefore: day(body.participation_createdBefore),
    group: /^[a-z-]{2,40}$/.test(String(body.participation_group || '')) ? body.participation_group : '',
    rules,
    eligible: { source, value: source === 'none' ? '' : value, depth: Math.min(Math.max(parseInt(body.eligible_depth, 10) || 0, 0), 5) },
  };
  return {
    participation: JSON.stringify(participation),
    registrationRequired: mode !== 'submit',
    registrationEnabled: mode === 'register' || ((mode === 'onwiki' || mode === 'list') && participation.outsiders) || mode === 'onwiki',
  };
}

// --- The on-wiki page ------------------------------------------------------------

// Users linked from a page ([[User:X]] or {{u|X}} turn into user-page links).
async function pageUsers(wiki, title) {
  const names = new Set();
  let cont = {};
  for (let i = 0; i < 20; i += 1) {
    const data = await wikiApi.get(wiki, { action: 'query', prop: 'links', titles: title, plnamespace: '2', pllimit: 'max', ...cont });
    for (const p of data.query?.pages || []) for (const l of p.links || []) names.add(l.title.replace(/^[^:]+:/, '').split('/')[0]);
    if (!data.continue) break;
    cont = data.continue;
  }
  return [...names];
}

// May this user join? (Modes onwiki and list check the page or the list, unless others may join.)
async function joinCheck({ user, contest, settings }) {
  const p = read(settings);
  const now = new Date();
  if (p.regWindow === 'event' && ((contest.startDate && now < contest.startDate) || (contest.endDate && now > contest.endDate))) return 'Registration is open only while the event runs.';
  const made = user.wikimediaRegisteredAt ? new Date(user.wikimediaRegisteredAt) : null;
  if (p.createdAfter && made && made < new Date(p.createdAfter)) return 'Your Wikimedia account must be created after {date}.'.replace('{date}', p.createdAfter);
  if (p.createdBefore && made && made > new Date(p.createdBefore)) return 'Your Wikimedia account must be created before {date}.'.replace('{date}', p.createdBefore);
  if (p.group) {
    try {
      const data = await wikiApi.get(contest.primaryWiki, { action: 'query', list: 'users', ususers: user.username, usprop: 'groups' });
      const groups = data.query?.users?.[0]?.groups;
      // Unknown (the wiki didn't answer): not held against them.
      if (Array.isArray(groups) && !groups.includes(p.group)) return 'You need the {group} right on the wiki.'.replace('{group}', p.group);
    } catch { /* the wiki didn't answer */ }
  }
  if (p.mode === 'submit') return null;
  if (p.outsiders || p.mode === 'register') return null;
  if (p.mode === 'list') return p.users.some((u) => u.toLowerCase() === user.username.toLowerCase()) ? null : 'Only the listed participants can take part.';
  if (p.mode === 'onwiki') {
    try {
      const listed = await pageUsers(contest.primaryWiki, p.page);
      return listed.some((u) => u.toLowerCase() === user.username.toLowerCase()) ? null : 'Sign up on the event page on the wiki first.';
    } catch {
      return "The wiki's sign-up page couldn't be read. Try again later.";
    }
  }
  return null;
}

// A link that opens the on-wiki page with "* [[User:Name]]" added, ready to save.
function signUpUrl(contest, settings, username) {
  const p = read(settings);
  const host = dbnameToHost(contest.primaryWiki);
  if (!p.page || !host || !username) return null;
  const q = new URLSearchParams({ title: p.page.replace(/ /g, '_'), action: 'edit', section: 'new', preloadtitle: username, preloadtext: `* [[User:${username}|${username}]] ~~~~`, summary: username });
  return `https://${host}/w/index.php?${q}`;
}

// Adds the listed users (mode list), or everyone signed up on the page (mode onwiki), as participants.
async function importParticipants({ actorId, contest, settings }) {
  const p = read(settings);
  const names = p.mode === 'list' ? p.users : p.mode === 'onwiki' && p.page ? await pageUsers(contest.primaryWiki, p.page) : [];
  const directory = require('./userDirectoryService');
  const membership = require('./membershipService');
  let added = 0;
  const missing = [];
  for (const name of names.slice(0, 5000)) {
    const user = await directory.findOrImport(name).catch(() => null);
    if (!user) { missing.push(name); continue; }
    const roles = await membership.activeRoles(contest.id, user.id);
    if (roles.includes('participant')) continue;
    try {
      await membership.addMember({ actorId, contest, settings, user, role: 'participant' });
      added += 1;
    } catch {
      missing.push(name);
    }
  }
  return { added, missing };
}

// --- Eligible articles ----------------------------------------------------------

function titleOf(raw) {
  let t = String(raw).trim();
  const m = t.match(/\/wiki\/([^?#]+)/);
  if (m) t = decodeURIComponent(m[1]);
  return t.replace(/^\[\[|\]\]$/g, '').split('|')[0].replace(/_/g, ' ').trim();
}

async function categoryTitles(wiki, category, depth) {
  const out = new Set();
  const seen = new Set();
  let level = [`Category:${category.replace(/^(Category|বিষয়শ্রেণী):/i, '')}`];
  for (let d = 0; d <= depth && level.length; d += 1) {
    const next = [];
    for (const cat of level) {
      if (seen.has(cat)) continue;
      seen.add(cat);
      let cont = {};
      for (let i = 0; i < 50; i += 1) {
        const data = await wikiApi.get(wiki, { action: 'query', list: 'categorymembers', cmtitle: cat, cmnamespace: '0|14', cmlimit: 'max', ...cont });
        for (const m of data.query?.categorymembers || []) (m.ns === 14 ? next.push(m.title) : out.add(m.title));
        if (!data.continue || out.size >= MAX_TITLES) break;
        cont = data.continue;
      }
    }
    level = next;
  }
  return [...out];
}

// A SPARQL query: article URLs (schema:about … schema:isPartOf) or items, whose sitelinks on the
// event's wiki are used.
async function wikidataTitles(wiki, query) {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': env.userAgent, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Wikidata query failed (HTTP ${res.status}).`);
  const rows = (await res.json()).results?.bindings || [];
  const host = dbnameToHost(wiki);
  const titles = new Set();
  const items = new Set();
  for (const row of rows) {
    for (const cell of Object.values(row)) {
      const v = cell.value || '';
      if (host && v.startsWith(`https://${host}/wiki/`)) titles.add(titleOf(v));
      const q = v.match(/entity\/(Q\d+)$/);
      if (q) items.add(q[1]);
    }
  }
  if (!titles.size && items.size) {
    const ids = [...items];
    for (let i = 0; i < ids.length && titles.size < MAX_TITLES; i += 50) {
      const data = await wikiApi.get('wikidatawiki', { action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props: 'sitelinks', sitefilter: wiki });
      for (const e of Object.values(data.entities || {})) if (e.sitelinks?.[wiki]) titles.add(e.sitelinks[wiki].title);
    }
  }
  return [...titles];
}

async function resolveEligible(contest, settings) {
  const { source, value, depth } = read(settings).eligible;
  const wiki = contest.primaryWiki;
  let titles = [];
  if (source === 'list') titles = lines(value).map(titleOf);
  else if (source === 'page') {
    let cont = {};
    for (let i = 0; i < 50; i += 1) {
      const data = await wikiApi.get(wiki, { action: 'query', prop: 'links', titles: titleOf(value), plnamespace: '0', pllimit: 'max', ...cont });
      for (const p of data.query?.pages || []) for (const l of p.links || []) titles.push(l.title);
      if (!data.continue) break;
      cont = data.continue;
    }
  } else if (source === 'category') titles = await categoryTitles(wiki, titleOf(value), depth);
  else if (source === 'wikidata') titles = await wikidataTitles(wiki, value);
  titles = [...new Set(titles.filter(Boolean))].slice(0, MAX_TITLES);
  await prisma.contestSettings.update({ where: { contestId: contest.id }, data: { eligibleTitles: JSON.stringify(titles) } });
  return titles.length;
}

// After the settings are saved: the fixed list joins, and the eligible articles are fetched.
async function afterSave({ actorId, contest }) {
  const settings = await prisma.contestSettings.findUnique({ where: { contestId: contest.id } });
  if (!settings) return {};
  const out = {};
  if (read(settings).mode === 'list') out.imported = await importParticipants({ actorId, contest, settings }).catch(() => null);
  try {
    out.eligible = await resolveEligible(contest, settings);
  } catch (err) {
    out.eligibleError = err.message;
  }
  return out;
}

function eligibleSet(settings) {
  try {
    const list = JSON.parse(settings?.eligibleTitles || '[]');
    return list.length ? new Set(list.map((t) => t.replace(/_/g, ' '))) : null;
  } catch {
    return null;
  }
}

// --- Teams ------------------------------------------------------------------------

async function joinTeam(tx, { contestId, userId, name }) {
  const clean = str(name).replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) return null;
  const team = await tx.team.upsert({ where: { contestId_name: { contestId, name: clean } }, update: {}, create: { contestId, name: clean } });
  await tx.contestMembership.updateMany({ where: { contestId, userId, role: 'participant', status: 'active' }, data: { teamId: team.id } });
  return team;
}

function teams(contestId) {
  return prisma.team.findMany({ where: { contestId }, orderBy: { name: 'asc' }, include: { members: { where: { status: 'active', role: 'participant' }, include: { user: { select: { id: true, username: true } } } } } });
}

module.exports = { RULES, MODES, ASK, SOURCES, read, parse, joinCheck, signUpUrl, importParticipants, resolveEligible, afterSave, eligibleSet, joinTeam, teams, pageUsers };
