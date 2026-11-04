// Fountain (fountain.toolforge.org) editathons: import one as a Zury event, or let a wiki
// of an event follow one. Its articles become entries and the Fountain jury's marks
// decide them, so all results sit in Zury next to entries judged here.
const prisma = require('../config/prisma');
const env = require('../config/env');
const wikiApi = require('../wiki/wikiApi');
const { hostToDbname } = require('../wiki/wikiUrls');
const { pageUrl } = require('../wiki/wikiUrls');
const users = require('./userDirectoryService');
const eventService = require('./eventService');
const eventWikiService = require('./eventWikiService');
const audit = require('./auditService');

const API = 'https://fountain.toolforge.org/api/editathons';

class FountainError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Accepts a code or any Fountain address: https://fountain.toolforge.org/editathons/<code>.
function parseCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/editathons\/([^/?#\s]+)/);
  const code = decodeURIComponent(m ? m[1] : s);
  return /^[\w.-]{1,100}$/.test(code) ? code : '';
}

async function fetchEditathon(code) {
  let res;
  try {
    res = await fetch(`${API}/${encodeURIComponent(code)}`, { headers: { 'User-Agent': env.userAgent }, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new FountainError('Could not reach Fountain. Try again in a moment.');
  }
  if (res.status === 404) throw new FountainError('No Fountain editathon has this code.');
  if (!res.ok) throw new FountainError(`Fountain returned HTTP ${res.status}.`);
  const data = await res.json();
  if (!data || !data.code) throw new FountainError('No Fountain editathon has this code.');
  return data;
}

// Fountain names wikis by language code ("bn"); Zury by database name ("bnwiki").
function wikiOf(editathon) {
  return hostToDbname(`${editathon.wiki}.wikipedia.org`) || `${String(editathon.wiki).replace(/-/g, '_')}wiki`;
}

// One juror's marks add up to their points; the entry's score is the jurors' average.
// No marks yet: still pending. A zero score: rejected.
function decision(article) {
  const marks = (article.marks || []).filter((m) => m && m.marks && Object.keys(m.marks).length);
  if (!marks.length) return { status: 'pending', score: null };
  const points = marks.map((m) => Object.values(m.marks).reduce((a, v) => a + (Number(v) || 0), 0));
  const score = points.reduce((a, b) => a + b, 0) / points.length;
  return { status: score > 0 ? 'approved' : 'rejected', score };
}

async function pageIds(wiki, titles) {
  const ids = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const data = await wikiApi.get(wiki, { action: 'query', titles: titles.slice(i, i + 50).join('|'), redirects: '1' });
    const q = data.query || {};
    const back = new Map([...(q.normalized || []), ...(q.redirects || [])].map((r) => [r.to, r.from]));
    for (const p of q.pages || []) {
      if (p.missing || !p.pageid) continue;
      ids.set(p.title, p.pageid);
      if (back.has(p.title)) ids.set(back.get(p.title), p.pageid);
    }
  }
  return ids;
}

async function ensureMember(contestId, userId, role, wiki, actorId) {
  await prisma.contestMembership.upsert({
    where: { contestId_userId_role_wiki: { contestId, userId, role, wiki } },
    update: {},
    create: { contestId, userId, role, wiki, assignedById: actorId },
  });
}

// Brings one event wiki up to date with its Fountain editathon. Entries are matched by
// page, so running it again only adds new articles and updates decisions.
async function sync(eventWiki, { actorId = null } = {}) {
  const editathon = await fetchEditathon(eventWiki.fountainCode);
  const { contestId, wiki } = eventWiki;
  const people = new Map();
  const person = async (name) => {
    if (!people.has(name)) people.set(name, await users.findOrImport(name).catch(() => null));
    return people.get(name);
  };

  for (const name of editathon.jury || []) {
    const u = await person(name);
    if (u) await ensureMember(contestId, u.id, 'jury', wiki, actorId);
  }

  const articles = editathon.articles || [];
  const ids = await pageIds(wiki, [...new Set(articles.map((a) => a.name))]);
  const existing = await prisma.submission.findMany({ where: { contestId, wiki }, select: { id: true, pageKey: true, status: true, score: true } });
  const byKey = new Map(existing.map((s) => [s.pageKey, s]));
  let added = 0;
  let updated = 0;

  for (const a of articles) {
    const pageid = ids.get(a.name);
    const u = await person(a.user);
    if (!pageid || !u) continue;
    const pageKey = String(pageid);
    const { status, score } = decision(a);
    const have = byKey.get(pageKey);
    if (have) {
      if (have.status !== status || have.score !== score) {
        await prisma.submission.update({ where: { id: have.id }, data: { status, score } });
        updated++;
      }
      continue;
    }
    await ensureMember(contestId, u.id, 'participant', '', actorId);
    const row = await prisma.submission.create({
      data: {
        contestId, wiki, pageKey, status, score,
        participantId: u.id,
        submittedById: u.id,
        title: a.name,
        url: pageUrl(wiki, a.name),
        entryType: 'article',
        submittedAt: a.dateAdded ? new Date(a.dateAdded) : new Date(),
        metadata: JSON.stringify({ source: 'fountain', fountainId: a.id }),
      },
    });
    byKey.set(pageKey, row);
    added++;
  }

  await prisma.contestWiki.update({ where: { id: eventWiki.id }, data: { fountainSyncedAt: new Date() } });
  return { added, updated, total: articles.length };
}

// A new Zury event from a Fountain editathon, following it from then on.
async function importEvent({ actorId, input }) {
  const code = parseCode(input);
  if (!code) throw new FountainError('Enter a Fountain editathon code or address.');
  const linked = await prisma.contestWiki.findFirst({ where: { fountainCode: code, contest: { deletedAt: null } }, include: { contest: true } });
  if (linked) return { contest: linked.contest, existed: true };

  const e = await fetchEditathon(code);
  const wiki = wikiOf(e);
  const start = e.start ? new Date(e.start) : null;
  const finish = e.finish ? new Date(e.finish) : null;
  const contest = await eventService.create({
    actorId,
    type: 'editathon',
    autoSlug: true,
    parsed: {
      contest: {
        slug: code.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'fountain',
        title: String(e.name || code).trim().slice(0, 1000),
        description: String(e.description || '').trim(),
        primaryWiki: wiki,
        startDate: start,
        endDate: finish,
        submissionOpensAt: start,
        submissionDeadline: finish,
      },
      settings: {},
    },
  });
  const eventWiki = await prisma.contestWiki.findFirst({ where: { contestId: contest.id, wiki } });
  await prisma.contestWiki.update({ where: { id: eventWiki.id }, data: { fountainCode: code } });
  await audit.record({ actorId, contestId: contest.id, action: 'fountain.imported', entityType: 'Contest', entityId: contest.id, details: { code } });
  await sync({ ...eventWiki, fountainCode: code }, { actorId });
  return { contest, existed: false };
}

// Lets a wiki of an event (e.g. one edition of a series) follow a Fountain editathon;
// adds the wiki to the event when it isn't there yet.
async function link({ actorId, contest, input }) {
  const code = parseCode(input);
  if (!code) throw new FountainError('Enter a Fountain editathon code or address.');
  const e = await fetchEditathon(code);
  const wiki = wikiOf(e);
  let eventWiki = await prisma.contestWiki.findFirst({ where: { contestId: contest.id, wiki } });
  if (!eventWiki) eventWiki = await eventWikiService.addWiki({ actorId, contest, wiki });
  eventWiki = await prisma.contestWiki.update({ where: { id: eventWiki.id }, data: { fountainCode: code } });
  await audit.record({ actorId, contestId: contest.id, action: 'fountain.linked', entityType: 'ContestWiki', entityId: eventWiki.id, details: { code, wiki } });
  return { eventWiki, result: await sync(eventWiki, { actorId }) };
}

async function unlink({ actorId, contest, wikiId }) {
  const eventWiki = await prisma.contestWiki.findFirst({ where: { id: wikiId, contestId: contest.id } });
  if (!eventWiki) return;
  await prisma.contestWiki.update({ where: { id: eventWiki.id }, data: { fountainCode: '', fountainSyncedAt: null } });
  await audit.record({ actorId, contestId: contest.id, action: 'fountain.unlinked', entityType: 'ContestWiki', entityId: eventWiki.id, details: { code: eventWiki.fountainCode } });
}

// Hourly: every followed editathon of an event that is running or ended in the last 30 days.
async function syncAll() {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await prisma.contestWiki.findMany({
    where: { fountainCode: { not: '' }, status: 'active', contest: { deletedAt: null, OR: [{ endDate: null }, { endDate: { gte: since } }] } },
  });
  for (const row of rows) {
    try {
      await sync(row);
    } catch (err) {
      console.warn(`Fountain sync ${row.fountainCode}: ${err.message}`);
    }
  }
  return rows.length;
}

module.exports = { FountainError, parseCode, fetchEditathon, decision, importEvent, link, unlink, sync, syncAll };
