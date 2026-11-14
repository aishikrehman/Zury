// Organizers bring entries into an event from elsewhere: a list on a wiki page, a CSV or
// plain list, or a Fountain editathon (with its statuses and reviews).
// Every import is checked first (the preview); nothing is saved until the organizer confirms.
// The importer is the submitter; the participant is the one named in the source, otherwise
// the article's creator on the wiki. A status given by the source is kept as given, and the
// event's own checks still run and are shown next to it. Reviews from elsewhere are real
// reviews, marked with where they were made.
const prisma = require('../config/prisma');
const wikiApi = require('../wiki/wikiApi');
const submissionService = require('./submissionService');
const membershipService = require('./membershipService');
const users = require('./userDirectoryService');
const fountain = require('./fountainService');

const MAX_ROWS = 500;

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
    this.status = 400;
  }
}

// ── Reading the sources ─────────────────────────────────────────────────────

// "accepted", "গৃহীত", "yes", "1" … → approved; "rejected", "অগৃহীত", "no", "0" … → rejected.
function statusOf(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^(accepted|approved|accept|yes|y|1|ok|pass|গৃহীত|গ্রহণ|হ্যাঁ)$/.test(s)) return 'approved';
  if (/^(rejected|not accepted|reject|no|n|0|fail|অগৃহীত|বাতিল|প্রত্যাখ্যাত|না)$/.test(s)) return 'rejected';
  if (/^(pending|waiting|অপেক্ষমাণ)$/.test(s)) return '';
  return null; // something unrecognised: shown as a problem in the preview
}

// A wiki page's list: [[links]] when the page has them, otherwise its plain lines.
function titlesFromWikitext(text) {
  const links = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[1].trim();
    // Only articles: no files, categories, other namespaces or other wikis.
    if (!t || t.startsWith(':') || /^[^:]{1,30}:/.test(t)) continue;
    links.push(t);
  }
  if (links.length) return [...new Set(links)];
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[*#:;\s]+/, '').replace(/\{\{[^}]*\}\}/g, '').replace(/'{2,}/g, '').trim())
    .filter((l) => l && !/^(=|\{\||\|)/.test(l) && !l.startsWith('<'));
  return [...new Set(lines)];
}

async function fromWikiPage(wiki, page) {
  const title = String(page || '').trim().replace(/^https?:\/\/[^/]+\/wiki\//, '').replace(/_/g, ' ');
  if (!title) throw new ImportError('Give the name of the wiki page.');
  const data = await wikiApi.get(wiki, { action: 'query', prop: 'revisions', titles: decodeURIComponent(title), rvprop: 'content', rvslots: 'main', redirects: '1' });
  const p = data?.query?.pages?.[0];
  if (!p || p.missing) throw new ImportError(`No page named “${title}” on ${wiki}.`);
  const text = p.revisions?.[0]?.slots?.main?.content || '';
  return titlesFromWikitext(text).map((article) => ({ article }));
}

// CSV, TSV or semicolon lists; with a header row (article, participant, status, reviewer,
// note — in English or Bangla) or without one (in that order); or just one title per line.
function fromText(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = ['\t', ';', ','].find((d) => lines[0].includes(d));
  const split = (line) => {
    if (!delim) return [line.trim()];
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const NAMES = {
    article: /^(article|title|page|entry|নিবন্ধ|শিরোনাম|পাতা|জমা)$/i,
    participant: /^(participant|user|username|author|অংশগ্রহণকারী|ব্যবহারকারী|লেখক)$/i,
    status: /^(status|decision|result|অবস্থা|সিদ্ধান্ত|ফলাফল)$/i,
    reviewer: /^(reviewer|juror|jury|পর্যালোচক|বিচারক)$/i,
    note: /^(note|comment|reason|নোট|মন্তব্য|কারণ)$/i,
  };
  const head = split(lines[0]);
  const cols = {};
  head.forEach((h, i) => { for (const [k, re] of Object.entries(NAMES)) if (re.test(h.trim()) && cols[k] == null) cols[k] = i; });
  const hasHeader = cols.article != null;
  const order = hasHeader ? cols : { article: 0, participant: 1, status: 2, reviewer: 3, note: 4 };
  return (hasHeader ? lines.slice(1) : lines).map((line) => {
    const c = split(line);
    const get = (k) => (order[k] != null ? (c[order[k]] || '').trim() : '');
    return { article: get('article'), participant: get('participant'), status: get('status'), reviewer: get('reviewer'), note: get('note') };
  }).filter((r) => r.article);
}

// A Fountain editathon: its articles, who added them, the decision and each juror's marks.
async function fromFountain(input, contestWikis) {
  const code = fountain.parseCode(input);
  if (!code) throw new ImportError('Give the Fountain editathon code or its address.');
  const ed = await fountain.fetchEditathon(code);
  const wiki = fountain.wikiOf(ed);
  if (!contestWikis.includes(wiki)) throw new ImportError(`That editathon is on ${wiki}, which is not part of this event.`);
  return (ed.articles || []).map((a) => {
    const { status } = fountain.decision(a, ed.marks);
    const reviews = (a.marks || [])
      .filter((m) => m && (m.user || m.username || m.juror) && m.marks && Object.keys(m.marks).length)
      .map((m) => ({ reviewer: m.user || m.username || m.juror, ...fountain.reviewOf(m, ed.marks) }));
    return { article: a.name, participant: a.user || '', status: status === 'pending' ? '' : status, reviews, wiki, source: 'fountain' };
  });
}

// ── Checking (the preview) ──────────────────────────────────────────────────

// Problems that stop an entry even when the source gives its status.
const HARD = /already|not part of this event|does not exist|doesn't exist|not found|could not check|no page/i;

async function check({ req, rows }) {
  if (!rows.length) throw new ImportError('Nothing to import: no titles were found.');
  if (rows.length > MAX_ROWS) throw new ImportError(`At most ${MAX_ROWS} entries in one import.`);
  const items = [];
  // The event's own checks, in batches the entry checker accepts.
  for (let i = 0; i < rows.length; i += submissionService.MAX_BATCH) {
    const chunk = rows.slice(i, i + submissionService.MAX_BATCH);
    const checked = await submissionService.prepare({
      contest: req.contest,
      settings: req.eventSettings,
      participantId: req.user.id,
      text: chunk.map((r) => r.article).join('\n'),
      eventWikis: req.eventWikis,
      defaultWiki: chunk[0].wiki || req.contextWiki?.wiki,
      lateAllowed: true,
    });
    checked.forEach((it, j) => items.push({ row: chunk[j], it }));
  }
  const seen = new Set();
  const out = items.map(({ row, it }) => {
    const given = row.reviews ? row.status : statusOf(row.status);
    const hard = (it.reasons || []).filter((r) => HARD.test(r) || !it.meta);
    const soft = (it.reasons || []).filter((r) => !hard.includes(r));
    const key = it.meta ? `${it.meta.wiki}:${it.meta.title}` : row.article;
    const repeated = seen.has(key);
    seen.add(key);
    // An article started by a logged-out editor (an IP address) has no one to credit.
    const creator = it.meta && it.meta.creator && !/^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]+)$/i.test(it.meta.creator) ? it.meta.creator : '';
    const participant = row.participant || creator;
    // Pages started by an IP address or a bot come in only as someone's expansion (মানোন্নয়ন):
    // the source has to name the participant who expanded it.
    const byAnon = it.meta && it.meta.creator && !creator;
    const byBot = creator && /(bot\b|bot$|^bot|বট)/i.test(creator);
    const problems = [...hard];
    if (repeated) problems.push('Listed twice in this import.');
    if (given === null) problems.push(`Unknown status “${row.status}”.`);
    if ((byAnon || byBot) && !row.participant) problems.push(byBot ? 'Created by a bot: it can come in only as an expansion, with the participant named.' : 'Created by an IP address: it can come in only as an expansion, with the participant named.');
    // With a status from the source, the event's checks are shown but don't block it.
    const ok = !problems.length && (given ? true : it.ok);
    const kind = !it.meta || it.meta.exists === false || hard.some((x) => /does not exist|not found|no page/i.test(x)) ? 'missing' : hard.some((r) => /already/i.test(r)) || repeated ? 'duplicate' : ok ? 'new' : 'problem';
    return {
      article: row.article,
      meta: it.meta || null,
      participant,
      participantFrom: row.participant ? 'source' : participant ? 'creator' : '',
      status: given || '',
      checkStatus: it.status,
      reviewer: row.reviewer || '',
      note: row.note || '',
      reviews: row.reviews || null,
      checks: given ? soft : [],
      reasons: given ? problems : [...problems, ...soft],
      warnings: it.warnings || [],
      ok,
      kind,
    };
  });
  const count = (k) => out.filter((r) => r.kind === k).length;
  return {
    rows: out,
    summary: { total: out.length, ready: out.filter((r) => r.ok).length, new: count('new'), duplicate: count('duplicate'), missing: count('missing'), problem: count('problem'), noParticipant: out.filter((r) => r.ok && !r.participant).length },
  };
}

// ── Saving ──────────────────────────────────────────────────────────────────

async function commit({ req, preview, source }) {
  const actor = req.user;
  const people = new Map();
  const person = async (name) => {
    if (!name) return null;
    if (!people.has(name)) people.set(name, await users.findOrImport(name).catch(() => null));
    return people.get(name);
  };
  // One save per participant (each joins the event if they aren't in it).
  const groups = new Map();
  for (const r of preview.rows.filter((x) => x.ok)) {
    const who = (await person(r.participant)) || actor;
    if (!groups.has(who.id)) groups.set(who.id, { who, rows: [] });
    groups.get(who.id).rows.push(r);
  }
  let created = 0;
  let reviewed = 0;
  for (const { who, rows } of groups.values()) {
    const roles = await membershipService.activeRoles(req.contest.id, who.id);
    const items = rows.map((r) => ({ ok: true, input: r.article, meta: { ...r.meta, importedFrom: source }, warnings: [...r.warnings, ...r.checks], status: r.status || r.checkStatus || 'pending' }));
    const saved = await submissionService.save({
      actor,
      contest: req.contest,
      settings: req.settings,
      participant: who,
      items,
      ensureParticipant: roles.includes('participant') ? null : (tx) => membershipService.joinInTx(tx, { user: who, contest: req.contest, wiki: req.contextWiki?.wiki || '' }),
    }).catch((e) => { if (/None of these entries/.test(e.message)) return []; throw e; });
    created += saved.length;
    // Reviews made elsewhere, kept as reviews and marked with where they came from.
    for (const sub of saved) {
      const r = rows.find((x) => x.meta && x.meta.title === sub.title);
      if (!r) continue;
      const list = r.reviews ? r.reviews : r.reviewer && r.status ? [{ reviewer: r.reviewer, decision: r.status === 'approved' ? 'accept' : 'reject', points: 0, comment: r.note }] : [];
      for (const rv of list) {
        const juror = await person(rv.reviewer);
        if (!juror) continue;
        await prisma.review.upsert({
          where: { submissionId_jurorId: { submissionId: sub.id, jurorId: juror.id } },
          update: { decision: rv.decision, points: rv.points || 0, comment: String(rv.comment || '').slice(0, 2000), source: r.reviews ? 'fountain' : 'import' },
          create: { contestId: req.contest.id, submissionId: sub.id, jurorId: juror.id, decision: rv.decision, points: rv.points || 0, comment: String(rv.comment || '').slice(0, 2000), source: r.reviews ? 'fountain' : 'import' },
        });
        reviewed += 1;
      }
    }
  }
  await require('./auditService').record({ actorId: actor.id, contestId: req.contest.id, action: 'entries.imported', entityType: 'Contest', entityId: req.contest.id, details: { source, created, reviewed } }).catch(() => null);
  return { created, reviewed };
}

module.exports = { ImportError, MAX_ROWS, statusOf, titlesFromWikitext, fromWikiPage, fromText, fromFountain, check, commit };
