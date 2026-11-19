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
async function gather(req, form, events) {
  const byName = new Map();
  const add = (p) => { const k = p.username.toLowerCase(); if (!byName.has(k)) byName.set(k, p); };
  const allowed = new Set(events.map((e) => e.id));
  for (const id of [].concat(form.events || []).map(Number).filter((n) => allowed.has(n) || staff(req))) {
    const ev = events.find((e) => e.id === id);
    for (const p of await messageService.recipients({ contestId: id, audience: form.audience || 'participant' })) add({ ...p, wiki: p.wiki || (ev && ev.primaryWiki) || form.wiki });
  }
  const loose = [...lines(form.names), ...(form.pageTitle ? await namesOnPage(form.pageWiki || form.wiki, form.pageTitle).catch(() => { throw new MessageError('The wiki page could not be read.'); }) : [])];
  if (loose.length) {
    const known = await prisma.user.findMany({ where: { username: { in: loose.slice(0, MAX_NAMES) } }, select: { id: true, username: true, homeWiki: true, uiPrefs: true } });
    const k = new Map(known.map((u) => [u.username.toLowerCase(), u]));
    for (const n of loose.slice(0, MAX_NAMES)) add(k.get(n.toLowerCase()) ? { ...k.get(n.toLowerCase()), wiki: form.wiki } : { id: null, username: n, wiki: form.wiki });
  }
  const skip = new Set(lines(form.exclude).map((n) => n.toLowerCase()));
  return [...byName.values()].filter((p) => !skip.has(p.username.toLowerCase())).sort((a, b) => a.username.localeCompare(b.username)).slice(0, MAX_NAMES);
}

function render(req, res, locals) {
  res.status(locals.status || 200).render('pages/mass', {
    title: 'Mass message',
    form: { audience: 'participant', method: 'bell', wiki: req.user.homeWiki || 'bnwiki', ...locals.form },
    people: locals.people || null, result: locals.result || null, error: locals.error || null,
    events: locals.events, methods: res.locals.features.massMessages ? messageService.METHODS : Object.fromEntries(Object.entries(messageService.METHODS).filter(([k]) => k !== 'massmessage')),
    audiences: messageService.AUDIENCES, hasToken: !!req.session.wikimediaToken,
  });
}

async function page(req, res, next) {
  try {
    const events = await managedEvents(req);
    if (!events.length && !staff(req)) { const e = new Error('Only event organizers can send mass messages.'); e.status = 403; return next(e); }
    render(req, res, { events, form: {} });
  } catch (err) { next(err); }
}

async function send(req, res, next) {
  const form = { events: [].concat(req.body.events || []), audience: req.body.audience, names: req.body.names, pageWiki: String(req.body.pageWiki || '').trim(), pageTitle: String(req.body.pageTitle || '').trim(), exclude: req.body.exclude, wiki: String(req.body.wiki || '').trim(), method: req.body.method, subject: req.body.subject, body: req.body.body };
  let events = [];
  try {
    events = await managedEvents(req);
    if (!events.length && !staff(req)) { const e = new Error('Only event organizers can send mass messages.'); e.status = 403; return next(e); }
    const people = await gather(req, form, events);
    if (req.body.step !== 'send') return render(req, res, { events, form, people });
    // A notification reaches only people who use Zury.
    const to = form.method === 'bell' ? people.filter((p) => p.id) : people;
    const result = await messageService.send({ actor: req.user, accessToken: req.session.wikimediaToken, contest: { id: null, title: 'Zury', path: '/notifications' }, method: form.method, subject: form.subject, body: form.body, people: to, fallbackWiki: form.wiki || 'bnwiki' });
    render(req, res, { events, form, people, result });
  } catch (err) {
    if (!(err instanceof MessageError)) return next(err);
    render(req, res, { events, form, error: req.t(err.message), status: 422 });
  }
}

module.exports = { page, send };
