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
const words = require('../wiki/wordCount');
const lifecycle = require('./lifecycleService');

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

// Fountain stores, per criterion, the position of the chosen option (0 = the first, "Yes").
// As in ztools: no marks yet is pending; a juror choosing option 1 or 2 of the first
// criterion ("No", or "needs work") rejects; otherwise accepted. Points are the chosen
// options' values, averaged over the jurors.
function decision(article, marksConfig = {}) {
  const marks = (article.marks || []).filter((m) => m && m.marks && Object.keys(m.marks).length);
  if (!marks.length) return { status: 'pending', score: null };
  const rejected = marks.some((m) => [1, 2].includes(Number(m.marks['0'])));
  const valueOf = (criterion, pos) => {
    const opt = marksConfig[criterion]?.values?.[Number(pos)];
    return opt ? Number(opt.value) || 0 : 0;
  };
  const points = marks.map((m) => Object.entries(m.marks).reduce((a, [c, pos]) => a + valueOf(c, pos), 0));
  return { status: rejected ? 'rejected' : 'approved', score: points.reduce((a, b) => a + b, 0) / points.length };
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

// Word counts by page id, from the current wikitext (ztools rule) or plain text.
async function wordCounts(wiki, pageids, method) {
  const out = new Map();
  const ztools = words.methodFor(wiki, method) === 'ztools';
  for (let i = 0; i < pageids.length; i += 20) {
    const batch = pageids.slice(i, i + 20).join('|');
    const data = ztools
      ? await wikiApi.get(wiki, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', pageids: batch })
      : await wikiApi.get(wiki, { action: 'query', prop: 'extracts', explaintext: '1', exlimit: 'max', pageids: batch });
    for (const p of data.query?.pages || []) {
      const text = ztools ? p.revisions?.[0]?.slots?.main?.content : p.extract;
      if (text != null) out.set(String(p.pageid), ztools ? words.countZtools(text) : words.countPlain(text));
    }
  }
  return out;
}

// Word counts of each page as it was at `at` (one request per page: the API gives an old
// revision for one page at a time). Pages that did not exist yet count 0.
async function finalCounts(wiki, pageids, at, method) {
  const out = new Map();
  const ztools = words.methodFor(wiki, method) === 'ztools';
  for (const id of pageids) {
    try {
      const data = await wikiApi.get(wiki, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', pageids: String(id), rvstart: at.toISOString(), rvdir: 'older', rvlimit: '1' });
      const text = data.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
      out.set(String(id), text == null ? 0 : ztools ? words.countZtools(text) : words.countPlain(text.replace(/<[^>]+>|\{\{[^}]*\}\}|\[\[|\]\]|'''?/g, ' ')));
    } catch {
      // Left for the next sync.
    }
  }
  return out;
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
  const existing = await prisma.submission.findMany({ where: { contestId, wiki }, select: { id: true, pageKey: true, status: true, score: true, wordCount: true, metadata: true } });
  const settings = await prisma.contestSettings.findUnique({ where: { contestId }, select: { wordCountMethod: true } });
  const byKey = new Map(existing.map((s) => [s.pageKey, s]));
  // While it runs, articles are counted as they are now. Once it has ended, as they were at
  // the finish (like ztools), once per article; that count then stays.
  const finish = editathon.finish ? new Date(editathon.finish) : null;
  const ended = finish && Date.now() > finish.getTime();
  const isFinal = (s) => { try { return Boolean(JSON.parse(s.metadata || '{}').wordsAtFinish); } catch { return false; } };
  const counts = ended
    ? await finalCounts(wiki, [...new Set(ids.values())].filter((id) => !byKey.has(String(id)) || !isFinal(byKey.get(String(id)))), finish, settings?.wordCountMethod)
    : await wordCounts(wiki, [...new Set(ids.values())], settings?.wordCountMethod).catch(() => new Map());
  let added = 0;
  let updated = 0;

  for (const a of articles) {
    const pageid = ids.get(a.name);
    const u = await person(a.user);
    if (!pageid || !u) continue;
    const pageKey = String(pageid);
    const { status, score } = decision(a, editathon.marks);
    const wordCount = counts.has(pageKey) ? counts.get(pageKey) : null;
    const have = byKey.get(pageKey);
    if (have) {
      const newWords = wordCount ?? have.wordCount;
      const markFinal = ended && counts.has(pageKey);
      if (have.status !== status || have.score !== score || have.wordCount !== newWords || markFinal) {
        const meta = markFinal ? JSON.stringify({ ...JSON.parse(have.metadata || '{}'), wordsAtFinish: finish.toISOString() }) : undefined;
        await prisma.submission.update({ where: { id: have.id }, data: { status, score, wordCount: newWords, ...(meta && { metadata: meta }) } });
        updated++;
      }
      continue;
    }
    await ensureMember(contestId, u.id, 'participant', '', actorId);
    const row = await prisma.submission.create({
      data: {
        contestId, wiki, pageKey, status, score, wordCount,
        participantId: u.id,
        submittedById: u.id,
        title: a.name,
        url: pageUrl(wiki, a.name),
        entryType: 'article',
        submittedAt: a.dateAdded ? new Date(a.dateAdded) : new Date(),
        metadata: JSON.stringify({ source: 'fountain', fountainId: a.id, ...(ended && counts.has(pageKey) && { wordsAtFinish: finish.toISOString() }) }),
      },
    });
    byKey.set(pageKey, row);
    added++;
  }

  await prisma.contestWiki.update({ where: { id: eventWiki.id }, data: { fountainSyncedAt: new Date() } });
  return { added, updated, total: articles.length };
}

// A new Zury event from a Fountain editathon, following it from then on.
// series: optional { slug, edition, title } to put the event in a series or edition.
async function importEvent({ actorId, input, type = 'writing', series = null }) {
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
    type,
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
      // Fountain's jury decides the entries, so Zury's own review stays off.
      settings: { juryReviewEnabled: false },
      series,
    },
  });
  // The editathon is already running on Fountain: publish it straight away.
  if (start && finish) {
    const status = lifecycle.computeAutoStatus({ startDate: start, endDate: finish, submissionDeadline: finish }, { juryReviewEnabled: false });
    await prisma.contest.update({ where: { id: contest.id }, data: { status, statusMode: 'auto' } });
  }
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
