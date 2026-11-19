// /mass: a mass message tool on its own. People are gathered from several sources at once (the
// events someone runs, a pasted list, the user links on a wiki page), shown for a check, then sent
// as a Zury notification, talk-page sections, emails, or a MassMessage list on the wiki.
const prisma = require('../config/prisma');
const messageService = require('../services/messageService');
const wikiApi = require('../wiki/wikiApi');

const { MessageError } = messageService;
const lines = (v) => [...new Set(String(v || '').split(/[\n,]/).map((s) => s.replace(/^(User|User talk|ব্যবহারকারী|ব্যবহারকারী আলাপ):/i, '').replace(/_/g, ' ').trim()).filter(Boolean))];
const MAX_NAMES = 5000;

// Who may use it: organizers of any event, and site staff who send notifications.
async function managedEvents(req) {
  const rows = await prisma.contestMembership.findMany({
    where: { userId: req.user.id, role: 'organizer', status: 'active', contest: { deletedAt: null } },
    select: { contest: { select: { id: true, title: true, path: true, primaryWiki: true, status: true } } },
    distinct: ['contestId'], orderBy: { id: 'desc' }, take: 200,
  });
  return rows.map((r) => r.contest);
}
const staff = (req) => req.permissions.has('sendNotifications') || req.permissions.has('maintainSite');

// The user links on a wiki page (namespaces User and User talk), e.g. a sign-up page.
async function namesOnPage(wiki, title) {
  if (!wiki || !title) return [];
  const out = new Set();
  let cont = {};
  for (let i = 0; i < 20; i += 1) {
    const d = await wikiApi.get(wiki, { action: 'query', prop: 'links', titles: title, plnamespace: '2|3', pllimit: 'max', redirects: '1', ...cont });
    for (const l of d.query?.pages?.[0]?.links || []) out.add(l.title.replace(/^[^:]+:/, '').replace(/\/.*$/, ''));
    if (!d.continue) break;
    cont = d.continue;
  }
  return [...out];
}

// Everyone from the chosen sources, without repeats, minus the excluded names.
// An IP address (v4 or v6) or a temporary account (~2025-12345-67).
const anonymous = (n) => /^~/.test(n) || /^\d{1,3}(\.\d{1,3}){3}$/.test(n) || /^[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}$/i.test(n);

async function gather(req, form, events) {
  const byName = new Map();
  const left = [];
  const add = (p) => { const k = p.username.toLowerCase(); if (!byName.has(k)) byName.set(k, p); };
  const allowed = new Set(events.map((e) => e.id));
  for (const id of [].concat(form.events || []).map(Number).filter((n) => allowed.has(n) || staff(req))) {
    const ev = events.find((e) => e.id === id);
    for (const p of await messageService.recipients({ contestId: id, audience: form.audience || 'participant' })) add({ ...p, wiki: p.wiki || (ev && ev.primaryWiki) || form.wiki });
  }
  // Active editors of a wiki over a period (no bots).
  let active = [];
  if (form.activeWiki) {
    const r = await require('../services/activeEditorsService').activeEditors({ wiki: form.activeWiki, days: form.activeDays, minEdits: form.activeMin }).catch((err) => { throw new MessageError(req.t(err.message || 'The wiki could not be read.')); });
    active = r.people.map((p) => p.username);
    left.push(...r.left.map((p) => ({ username: p.username, why: p.why })));
  }
  // A Quarry query's result.
  let fromQuarry = [];
  if (form.quarry) {
    const q = await require('../services/quarryService').names(form.quarry, form.quarryColumn).catch((err) => { throw new MessageError(err.message); });
    fromQuarry = q.names;
    form.quarryNote = `${q.names.length} · ${q.column}`;
  }
  const loose = [...lines(form.names), ...active, ...fromQuarry, ...(form.pageTitle ? await namesOnPage(form.pageWiki || form.wiki, form.pageTitle).catch(() => { throw new MessageError('The wiki page could not be read.'); }) : [])];
  if (loose.length) {
    const known = await prisma.user.findMany({ where: { username: { in: loose.slice(0, MAX_NAMES) } }, select: { id: true, username: true, homeWiki: true, uiPrefs: true } });
    const k = new Map(known.map((u) => [u.username.toLowerCase(), u]));
    for (const n of loose.slice(0, MAX_NAMES)) add(k.get(n.toLowerCase()) ? { ...k.get(n.toLowerCase()), wiki: form.wiki } : { id: null, username: n, wiki: form.wiki });
  }
  const skip = new Set(lines(form.exclude).map((n) => n.toLowerCase()));
  const optedOut = (p) => { try { return !!JSON.parse(p.uiPrefs || '{}').noMass; } catch { return false; } };
  const people = [];
  let notOnZury = 0;
  for (const p of [...byName.values()].sort((a, b) => a.username.localeCompare(b.username))) {
    // IP addresses and temporary accounts never get mass messages and are not listed anywhere.
    if (anonymous(p.username)) continue;
    if (skip.has(p.username.toLowerCase())) continue;
    if (/bot(?![a-z])|বট/i.test(p.username)) left.push({ username: p.username, why: 'Bot-like name' });
    else if (form.method !== 'bell' && optedOut(p)) continue;
    else if (form.method === 'bell' && !p.id) notOnZury += 1;
    else people.push(p);
  }
  const kept = people.slice(0, MAX_NAMES);
  // Only the suspected bots and tools are shown as left out.
  kept.notOnZury = notOnZury;
  kept.left = left.filter((u) => !anonymous(u.username) && /bot/i.test(u.why || ''));
  return kept;
}

// How the message will look: wikitext made into HTML by the wiki itself (talk page, MassMessage);
// a notification is plain text.
async function preview(form) {
  const body = String(form.body || '').trim();
  if (!body) return null;
  if (form.method === 'bell') return { subject: form.subject, text: `${form.subject} — ${body}`.slice(0, 400) };
  const d = await wikiApi.get(form.wiki || 'bnwiki', { action: 'parse', text: `${body.slice(0, 1500)} ~~~~`, contentmodel: 'wikitext', prop: 'text', disablelimitreport: '1', pst: '1' });
  return { subject: form.subject, html: d.parse?.text || '' };
}

function render(req, res, locals) {
  res.status(locals.status || 200).render('pages/mass', {
    title: 'Mass message',
    form: { audience: 'participant', method: 'bell', wiki: req.user.homeWiki || 'bnwiki', ...locals.form },
    step: locals.step || 'who', notOnZury: locals.notOnZury || 0, people: locals.people || null, left: locals.left || [], result: locals.result || null, error: locals.error || null, preview: locals.preview || null,
    events: locals.events, methods: res.locals.features.massMessages && res.locals.mmOk ? messageService.METHODS : Object.fromEntries(Object.entries(messageService.METHODS).filter(([k]) => k !== 'massmessage')),
    audiences: messageService.AUDIENCES, hasToken: !!req.session.wikimediaToken,
  });
}

async function page(req, res, next) {
  try {
    if (!req.permissions.has('accessAdmin')) { const e = new Error('Only admins can use this tool.'); e.status = 403; return next(e); }
    const events = await managedEvents(req);
    res.locals.mmOk = await messageService.canMassMessage(req.user.username, req.user.homeWiki || 'bnwiki');
    render(req, res, { events, form: {} });
  } catch (err) { next(err); }
}

async function send(req, res, next) {
  const form = { quarry: String(req.body.quarry || '').trim(), quarryColumn: String(req.body.quarryColumn || '').trim(), activeWiki: String(req.body.activeWiki || '').trim(), activeDays: req.body.activeDays, activeMin: req.body.activeMin, events: [].concat(req.body.events || []), audience: req.body.audience, names: req.body.names, pageWiki: String(req.body.pageWiki || '').trim(), pageTitle: String(req.body.pageTitle || '').trim(), exclude: req.body.exclude, wiki: String(req.body.wiki || '').trim(), method: req.body.method, subject: req.body.subject, body: req.body.body };
  let events = [];
  try {
    if (!req.permissions.has('accessAdmin')) { const e = new Error('Only admins can use this tool.'); e.status = 403; return next(e); }
    events = await managedEvents(req);
    res.locals.mmOk = await messageService.canMassMessage(req.user.username, form.wiki || req.user.homeWiki || 'bnwiki');
    // People ticked to drop on the people step join the "leave out" list.
    const drop = [].concat(req.body.drop || []).map((s) => String(s).trim()).filter(Boolean);
    if (drop.length) form.exclude = [String(form.exclude || '').trim(), ...drop].filter(Boolean).join('\n');
    const STEPS = ['who', 'people', 'message', 'preview', 'send'];
    const step = STEPS.includes(req.body.step) ? req.body.step : 'who';
    if (step === 'who') return render(req, res, { events, form, step });
    const people = await gather(req, ['preview', 'send'].includes(step) ? form : { ...form, method: '' }, events);
    if (step === 'people' && !people.length) return render(req, res, { events, form, step: 'who', error: people.notOnZury ? req.t('{n} people found, but none use Zury, so a Zury notification cannot reach them. Choose talk page or email.', { n: people.notOnZury }) : req.t('Nobody matches these recipients.'), status: 422 });
    if (step === 'message' || step === 'people') return render(req, res, { events, form, step, people, left: people.left, notOnZury: people.notOnZury });
    if (step === 'preview') {
      if (String(form.subject || '').trim().length < 3 || String(form.body || '').trim().length < 3) return render(req, res, { events, form, step: 'message', people, left: people.left, error: req.t('Enter a subject and a message.'), status: 422 });
      return render(req, res, { events, form, step, people, left: people.left, notOnZury: people.notOnZury, preview: await preview(form).catch(() => null) });
    }
    // A notification reaches only people who use Zury.
    const to = people;
    const result = await messageService.send({ actor: req.user, accessToken: req.session.wikimediaToken, contest: { id: null, title: 'Zury', path: '/notifications' }, method: form.method, subject: form.subject, body: form.body, people: to, fallbackWiki: form.wiki || 'bnwiki' });
    render(req, res, { events, form, step: 'status', people, left: people.left, result });
  } catch (err) {
    if (!(err instanceof MessageError)) return next(err);
    const back = { send: 'preview', preview: 'message', message: 'people', people: 'who' }[req.body.step] || 'who';
    render(req, res, { events, form, step: back === 'people' ? 'who' : back, error: req.t(err.message), status: 422 });
  }
}

module.exports = { page, send };
