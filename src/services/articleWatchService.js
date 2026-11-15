// Keeps entered articles in step with their wikis.
// - While an event runs (revision rule "live", the default), each article's revision and word
//   count follow the wiki; after the event's end they stay as they were (reviewers and organizers
//   can still bring one up to date by hand).
// - Always (also for some time after the end): a deleted article, one turned into a redirect, or
//   one moved to a new title is marked; a move brings the new title along.
// - A decided entry whose article shrank a lot afterwards is marked for a second look.
// The marks live in the entry's metadata ("watch") and show in the Patrol room.
const prisma = require('../config/prisma');
const wikiApi = require('../wiki/wikiApi');
const participation = require('./participationService');

const AFTER_END_DAYS = 60; // deletion/move checks continue this long after an event ends
const SHRINK = 0.2; // a fall of a fifth or more in words after the decision is worth a look
const DECIDED = ['approved', 'rejected', 'disqualified'];

const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
const norm = (t) => String(t || '').replace(/_/g, ' ').trim();
const pageIdOf = (s, m) => m.pageId || Number(String(s.pageKey || '').split(':')[1]) || null;

function ruleOf(settings) {
  const r = participation.read(settings).rules;
  return { revision: r.revision || 'live', ownWords: r.ownWords === 'on' };
}

// Is the event still running (entries still follow the wiki)?
function running(contest, now = Date.now()) {
  if (['completed', 'archived', 'cancelled'].includes(contest.status)) return false;
  return !contest.endDate || new Date(contest.endDate).getTime() >= now;
}

// One batch of up to 50 pages of a wiki: id → { missing, redirect, title, lastrevid, length }.
async function pageInfo(wiki, ids) {
  const out = new Map();
  const data = await wikiApi.get(wiki, { action: 'query', prop: 'info', pageids: ids.join('|') });
  for (const p of data.query?.pages || []) out.set(p.pageid, p);
  return out;
}

// Checks the entries of one event; returns how many changed.
async function checkEvent(contest, settings, { force = false, ids = null } = {}) {
  const live = running(contest);
  const { revision, ownWords } = ruleOf(settings);
  const follow = live && revision === 'live';
  const entries = await prisma.submission.findMany({
    where: { contestId: contest.id, entryType: 'article', status: { not: 'withdrawn' }, ...(ids && { id: { in: ids } }) },
    select: { id: true, wiki: true, title: true, pageKey: true, revId: true, wordCount: true, status: true, metadata: true, participantId: true, url: true },
  });
  const byWiki = new Map();
  for (const s of entries) {
    const m = parse(s.metadata);
    const pid = pageIdOf(s, m);
    if (!pid) continue;
    if (!byWiki.has(s.wiki)) byWiki.set(s.wiki, []);
    byWiki.get(s.wiki).push({ s, m, pid });
  }
  let changed = 0;
  const now = new Date().toISOString();
  for (const [wiki, list] of byWiki) {
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      let info;
      try { info = await pageInfo(wiki, chunk.map((x) => x.pid)); } catch { continue; }
      for (const { s, m, pid } of chunk) {
        const p = info.get(pid);
        if (!p) continue;
        const watch = { ...(m.watch || {}) };
        const data = {};
        let meta = { ...m };
        const before = JSON.stringify(watch);
        if (p.missing) {
          watch.state = 'deleted';
        } else if (p.redirect) {
          watch.state = 'redirect';
        } else {
          if (norm(p.title) !== norm(s.title)) {
            // Moved: the entry follows its page to the new title.
            watch.state = 'moved';
            watch.movedFrom = s.title;
            watch.movedAt = now;
            data.title = p.title;
            data.url = require('../wiki/wikiUrls').pageUrl(wiki, p.title) || s.url;
            meta.title = p.title;
          } else if (watch.state === 'deleted' || watch.state === 'redirect') {
            watch.state = 'restored';
          }
          meta.currentRevId = p.lastrevid;
          // While the event runs, the entry is its latest revision, words and all.
          if ((follow || force) && p.lastrevid && p.lastrevid !== s.revId) {
            const fresh = await require('../wiki/entryMetadata').fetchEntryMetadata({ wiki, pageId: pid }, { language: contest.language, wordCountMethod: settings.wordCountMethod || 'auto' }).catch(() => null);
            if (fresh && fresh.exists) {
              data.revId = fresh.revId ?? p.lastrevid;
              let words = fresh.wordCount ?? s.wordCount;
              if (ownWords && contest.startDate) {
                const own = await ownWordsDuring({ wiki, pageId: pid, contest, participantId: s.participantId }).catch(() => null);
                if (own != null) { meta.ownWords = own; words = own; }
              }
              data.wordCount = words;
              meta = { ...meta, ...fresh, ...(meta.ownWords != null && { ownWords: meta.ownWords }), entryType: m.entryType || fresh.entryType, createdAt: m.createdAt || fresh.createdAt, creator: m.creator || fresh.creator, currentRevId: fresh.revId, updatedFromWikiAt: now };
            }
          }
        }
        // A decided entry: remember its words at the decision; a big fall afterwards is marked.
        if (DECIDED.includes(s.status)) {
          if (watch.decidedWords == null) watch.decidedWords = s.wordCount ?? null;
          const nowWords = data.wordCount ?? s.wordCount;
          if (watch.decidedWords && nowWords != null && nowWords < watch.decidedWords * (1 - SHRINK) && !watch.shrinkSeen) watch.shrunk = { from: watch.decidedWords, to: nowWords };
          else if (watch.shrunk && nowWords != null && nowWords >= watch.decidedWords * (1 - SHRINK)) delete watch.shrunk;
        }
        if (!live) { watch.survives = !p.missing && !p.redirect; watch.survivalAt = now; }
        watch.checkedAt = now;
        meta.watch = watch;
        if (JSON.stringify(watch) !== before) changed += 1;
        await prisma.submission.update({ where: { id: s.id }, data: { ...data, metadata: JSON.stringify(meta) } }).catch(() => null);
      }
    }
  }
  return changed;
}

// Words the participant added to the page between the event's start and end, their own edits
// only (what they removed is taken off; edits undone by others still count as made).
async function ownWordsDuring({ wiki, pageId, contest, participantId }) {
  const user = await prisma.user.findUnique({ where: { id: participantId }, select: { username: true } });
  if (!user) return null;
  const { countWords } = require('../wiki/entryMetadata');
  const start = new Date(contest.startDate).toISOString();
  const end = (contest.endDate ? new Date(contest.endDate) : new Date()).toISOString();
  let total = 0;
  let cont = {};
  for (let round = 0; round < 10; round += 1) {
    const data = await wikiApi.get(wiki, { action: 'query', prop: 'revisions', pageids: String(pageId), rvprop: 'ids|user', rvstart: start, rvend: end, rvdir: 'newer', rvlimit: '50', ...cont });
    const revs = data.query?.pages?.[0]?.revisions || [];
    for (const r of revs) {
      if (norm(r.user) !== norm(user.username)) continue;
      // The plain text before and after this edit, compared by word count.
      const diff = await wikiApi.get(wiki, { action: 'compare', fromrev: String(r.parentid || 0), torev: String(r.revid), prop: 'diff', difftype: 'inline' }).catch(() => null);
      const html = diff?.compare?.body || '';
      const added = [...html.matchAll(/<ins[^>]*>([\s\S]*?)<\/ins>/g)].map((x) => x[1]).join(' ');
      const removed = [...html.matchAll(/<del[^>]*>([\s\S]*?)<\/del>/g)].map((x) => x[1]).join(' ');
      const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, ' ').replace(/<ref[\s\S]*?<\/ref>/g, ' ');
      total += countWords(strip(added)) - countWords(strip(removed));
    }
    if (!data.continue) break;
    cont = data.continue;
  }
  return Math.max(0, total);
}

// Every few hours: running events, and events that ended in the last AFTER_END_DAYS.
async function sweep() {
  const since = new Date(Date.now() - AFTER_END_DAYS * 86400000);
  const events = await prisma.contest.findMany({
    where: { deletedAt: null, status: { notIn: ['draft', 'cancelled'] }, OR: [{ endDate: null }, { endDate: { gte: since } }] },
    include: { settings: true },
  });
  let total = 0;
  for (const { settings, ...contest } of events) {
    if (!settings) continue;
    try { total += await checkEvent(contest, settings); } catch (err) { console.error(`Article watch "${contest.title}":`, err.message); }
  }
  return total;
}

// Marks a flag as looked at (it stays in the entry's record).
async function markSeen(submission, kind) {
  const m = parse(submission.metadata);
  const watch = { ...(m.watch || {}) };
  if (kind === 'shrunk') { watch.shrinkSeen = true; delete watch.shrunk; } else { watch.seen = { ...(watch.seen || {}), [watch.state]: new Date().toISOString() }; }
  await prisma.submission.update({ where: { id: submission.id }, data: { metadata: JSON.stringify({ ...m, watch }) } });
}

// What the Patrol room lists for an event: open flags, newest first.
function flagsOf(s) {
  const w = parse(s.metadata).watch || {};
  const out = [];
  if (['deleted', 'redirect', 'moved'].includes(w.state) && !(w.seen && w.seen[w.state])) out.push(w.state);
  if (w.shrunk) out.push('shrunk');
  return out;
}

// Of an event's accepted articles, how many still stand (as last checked).
async function survival(contestIds) {
  const rows = await prisma.submission.findMany({ where: { contestId: { in: contestIds }, status: 'approved', entryType: 'article' }, select: { metadata: true } });
  let checked = 0; let stand = 0; let deleted = 0; let redirect = 0;
  for (const r of rows) {
    const w = parse(r.metadata).watch;
    if (!w || !w.checkedAt) continue;
    checked += 1;
    if (w.state === 'deleted') deleted += 1;
    else if (w.state === 'redirect') redirect += 1;
    else stand += 1;
  }
  return { accepted: rows.length, checked, stand, deleted, redirect };
}

module.exports = { checkEvent, sweep, markSeen, flagsOf, survival, running, ruleOf, ownWordsDuring };
