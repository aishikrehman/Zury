// Chat pages: /chat (everyone, and two-person conversations) and <event>/chat (the event's room,
// and its reviewers' room). Pages are made on the server; new messages arrive as server-sent events.
const prisma = require('../config/prisma');
const chat = require('../services/chatService');

// Only superusers clear a whole chat (or all chats).
const isSuperuser = (req) => ((req.subject && req.subject.user && req.subject.user.globalRoles) || []).some((r) => r.role === 'superuser');
const forbidden = (next) => { const e = new Error("You don't have permission to do that."); e.status = 403; next(e); };
// Deleting is for superusers only.
const moderatorOf = (req) => isSuperuser(req);

// The event rooms this person may use, as the event's settings allow.
function eventRooms(req) {
  const staff = req.permissions.has('reviewAppeal') || req.permissions.has('manageAppeals') || req.permissions.has('manageEvent') || (req.scope.eventRoles || []).includes('jury');
  const x = require('../services/extrasService').read(req.eventSettings || req.settings);
  // An archived (or deleted) event has no chat any more.
  if (req.contest.status === 'archived' || req.contest.deletedAt) return { event: null, jury: null };
  const f = require('../services/featureService').now();
  return { event: f.chat && x.chat ? `e${req.contest.id}` : null, jury: f.juryChat && staff && x.juryChat ? `j${req.contest.id}` : null };
}

// A chat's addresses: an event's rooms live under the event; series and edition rooms under /chat.
function chatUrls(channel, path) {
  if (/^[ej]\d+$/.test(channel)) {
    const q = channel[0] === 'j' ? '?room=jury' : '';
    return { send: `${path}/chat/send${q}`, stream: `${path}/chat/stream${q}`, hide: (id) => `${path}/chat/${id}/hide${q}`, clear: `${path}/chat/clear${q}`, download: `${path}/chat/download${q}` };
  }
  return { send: `/chat/send?c=${channel}`, stream: `/chat/stream?c=${channel}`, hide: (id) => `/chat/${id}/hide?c=${channel}`, clear: `/chat/clear?c=${channel}`, download: `/chat/download?c=${channel}` };
}
const hideUrlFor = (req, channel) => chatUrls(channel, req.base).hide;
// One message as HTML, for the page or the live stream.
function renderer(req, res, kind, channel) {
  return (m) => new Promise((resolve, reject) => {
    req.app.render('partials/chatMessage', { ...res.locals, m, me: req.user, canHide: moderatorOf(req, kind), hideUrl: hideUrlFor(req, channel, kind)(m.id) }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

// A chat's latest messages and addresses, for its box. path: the event's address (event rooms).
async function box(req, res, channel, kind, path = req.base) {
  const before = Number(req.query.before) || null;
  const messages = await chat.list(channel, { before });
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  if (req.user && !before) await chat.markRead(req.user.id, channel, lastId);
  const u = chatUrls(channel, path);
  return { live: require('../services/featureService').now().liveChat, downloadUrl: u.download, channel, kind, messages, lastId, sendUrl: u.send, streamUrl: u.stream, before, canHide: moderatorOf(req, kind), hideUrl: u.hide, clearUrl: isSuperuser(req) ? u.clear : null };
}

// ── Series and edition rooms (/chat/…?c=s<id> or x<id>): anyone signed in, when the series or edition is open to them ──
async function levelChannel(req) {
  const c = String(req.query.c || (req.body && req.body.c) || '');
  const ch = chat.parseChannel(c);
  if (!ch) return null;
  const f = require('../services/featureService').now();
  if (ch.kind === 'direct') {
    if (!f.directMessages || !req.user || !ch.users.includes(req.user.id)) return null;
    return { c, ch, link: `/inbox?c=${c}` };
  }
  if (!['series', 'edition'].includes(ch.kind) || !f.levelChat) return null;
  const row = ch.kind === 'series'
    ? await prisma.eventSeries.findFirst({ where: { id: ch.id, deletedAt: null }, select: { slug: true, status: true, visibility: true } })
    : await prisma.edition.findFirst({ where: { id: ch.id, deletedAt: null }, select: { slug: true, status: true, visibility: true, series: { select: { slug: true } } } });
  if (!row || row.visibility === 'private' || ['draft', 'archived'].includes(row.status)) return null;
  const link = ch.kind === 'series' ? `/${row.slug}?tab=chat` : `/series/${row.series.slug}/${row.slug}?tab=chat`;
  return { c, ch, link };
}

async function stream(req, res, next) {
  try {
    const sel = await levelChannel(req);
    if (!sel) return forbidden(next);
    await chat.stream(req, res, sel.c, renderer(req, res, sel.ch.kind, sel.c));
  } catch (err) { next(err); }
}

async function send(req, res, next, channel, contest = null, link = '') {
  const back = req.get('Referer') || '/';
  try {
    await chat.post({ user: req.user, channel, body: req.body.body, contest, link });
    if (req.xhr || req.get('Accept')?.includes('json')) return res.json({ ok: true });
    res.redirect(back);
  } catch (err) {
    if (!(err instanceof chat.ChatError)) return next(err);
    if (req.xhr || req.get('Accept')?.includes('json')) return res.status(400).json({ error: req.t(err.message) });
    req.flash('danger', err.message);
    res.redirect(back);
  }
}

const sendGlobal = async (req, res, next) => {
  const sel = await levelChannel(req).catch(() => null);
  if (!sel) return forbidden(next);
  if (sel.ch.kind === 'direct' && !(await chat.mayWrite(...sel.ch.users))) return send(req, res, next, null);
  return send(req, res, next, sel.c, null, sel.link);
};

async function hide(req, res, next, channel, kind) {
  try {
    if (!isSuperuser(req)) return forbidden(next);
    await chat.hide({ actor: req.user, id: Number(req.params.id), channel, own: false });
    if (req.xhr || req.get('Accept')?.includes('json')) return res.json({ ok: true });
  } catch (err) {
    if (!(err instanceof chat.ChatError)) return next(err);
    req.flash('danger', err.message);
  }
  res.redirect(req.get('Referer') || '/');
}
const hideGlobal = async (req, res, next) => { const sel = await levelChannel(req).catch(() => null); return sel ? hide(req, res, next, sel.c, sel.ch.kind) : forbidden(next); };

// ── <event>/chat ──
function eventRoom(req) {
  const rooms = eventRooms(req);
  const room = (req.query.room || req.body?.room) === 'jury' ? 'jury' : 'event';
  const channel = rooms[room];
  return channel ? { room, channel, rooms, kind: room } : null;
}

// The chat pop-up's contents (fetched when opened): an event's rooms as tabs, or a series' or edition's room.
function renderPanel(req, res, next, locals) {
  res.render('partials/chatPanel', { layout: false, ...locals }, (err, html) => (err ? next(err) : res.set('Cache-Control', 'no-store').send(html)));
}
async function eventPanel(req, res, next) {
  try {
    const rooms = eventRooms(req);
    const room = req.query.room === 'jury' && rooms.jury ? 'jury' : rooms.event ? 'event' : rooms.jury ? 'jury' : null;
    if (!room) return res.status(404).end();
    const tabs = [...(rooms.event ? [['event', req.t('Everyone'), `${req.base}/chat/panel`]] : []), ...(rooms.jury ? [['jury', req.t('Reviewers and organizers'), `${req.base}/chat/panel?room=jury`]] : [])];
    renderPanel(req, res, next, { title: req.contest.title, tabs, room, chatBox: await box(req, res, rooms[room], room) });
  } catch (err) { next(err); }
}
async function levelPanel(req, res, next) {
  try {
    const sel = await levelChannel(req);
    if (!sel) return res.status(404).end();
    renderPanel(req, res, next, { title: '', tabs: [], room: sel.ch.kind, chatBox: await box(req, res, sel.c, sel.ch.kind, '') });
  } catch (err) { next(err); }
}

// The chat as a text file.
async function download(req, res, next, channel, title) {
  try {
    const text = await chat.exportText(channel, title);
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="zury-chat-${channel}-${new Date().toISOString().slice(0, 10)}.txt"` });
    res.send('\ufeff' + text);
  } catch (err) { next(err); }
}
const eventDownload = (req, res, next) => { const sel = eventRoom(req); return sel ? download(req, res, next, sel.channel, `${req.contest.title} — ${req.t(sel.room === 'jury' ? 'Reviewers and organizers' : 'Everyone')}`) : forbidden(next); };
const levelDownload = async (req, res, next) => { const sel = await levelChannel(req).catch(() => null); return sel ? download(req, res, next, sel.c, sel.c) : forbidden(next); };

async function eventStream(req, res, next) {
  try {
    const sel = eventRoom(req);
    if (!sel) return forbidden(next);
    await chat.stream(req, res, sel.channel, renderer(req, res, sel.kind, sel.channel));
  } catch (err) { next(err); }
}

const eventSend = (req, res, next) => { const sel = eventRoom(req); return sel ? send(req, res, next, sel.channel, req.contest) : forbidden(next); };
const eventHide = (req, res, next) => { const sel = eventRoom(req); return sel ? hide(req, res, next, sel.channel, sel.kind) : forbidden(next); };

async function clearAction(req, res, next, channel) {
  try {
    if (!isSuperuser(req)) return forbidden(next);
    const n = await chat.clear(req.body.all === '1' && !req.contest ? null : channel);
    req.flash('success', req.t('{n} messages deleted.', { n }));
    const back = String(req.body.back || '');
    res.redirect(require('../utils/safePath').localOr(back, '/'));
  } catch (err) { next(err); }
}
const clearGlobal = async (req, res, next) => { const sel = await levelChannel(req).catch(() => null); return sel || req.body.all === '1' ? clearAction(req, res, next, sel && sel.c) : forbidden(next); };
const eventClear = (req, res, next) => { const sel = eventRoom(req); return sel ? clearAction(req, res, next, sel.channel) : forbidden(next); };

module.exports = { chatUrls, box, eventPanel, levelPanel, eventDownload, levelDownload, eventRooms, clearGlobal, eventClear, isSuperuser, stream, sendGlobal, hideGlobal, eventStream, eventSend, eventHide };
