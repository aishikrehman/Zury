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
  return { event: x.chat ? `e${req.contest.id}` : null, jury: staff && x.juryChat ? `j${req.contest.id}` : null };
}

// One message as HTML, for the page or the live stream.
// Where a message's delete/hide button posts.
const hideUrlFor = (req, channel, kind) => (id) => (req.contest ? `${req.base}/chat/${id}/hide${kind === 'jury' ? '?room=jury' : ''}` : `/chat/${id}/hide?c=${channel}`);
function renderer(req, res, kind, channel) {
  return (m) => new Promise((resolve, reject) => {
    req.app.render('partials/chatMessage', { ...res.locals, m, me: req.user, canHide: moderatorOf(req, kind), hideUrl: hideUrlFor(req, channel, kind)(m.id) }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

async function box(req, res, channel, kind, sendUrl, streamUrl) {
  const before = Number(req.query.before) || null;
  const messages = await chat.list(channel, { before });
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  if (req.user && !before) await chat.markRead(req.user.id, channel, lastId);
  const downloadUrl = req.contest ? `${req.base}/chat/download${kind === 'jury' ? '?room=jury' : ''}` : `/chat/download?c=${channel}`;
  return { downloadUrl, channel, kind, messages, lastId, sendUrl, streamUrl, before, canHide: moderatorOf(req, kind), hideUrl: hideUrlFor(req, channel, kind), clearUrl: isSuperuser(req) ? (req.contest ? `${req.base}/chat/clear${kind === 'jury' ? '?room=jury' : ''}` : `/chat/clear?c=${channel}`) : null };
}

// ── Series and edition rooms (/chat/…?c=s<id> or x<id>): anyone signed in, when the series or edition is open to them ──
async function levelChannel(req) {
  const c = String(req.query.c || (req.body && req.body.c) || '');
  const ch = chat.parseChannel(c);
  if (!ch || !['series', 'edition'].includes(ch.kind)) return null;
  const row = ch.kind === 'series'
    ? await prisma.eventSeries.findFirst({ where: { id: ch.id, deletedAt: null }, select: { slug: true, status: true, visibility: true } })
    : await prisma.edition.findFirst({ where: { id: ch.id, deletedAt: null }, select: { slug: true, status: true, visibility: true, series: { select: { slug: true } } } });
  if (!row || row.visibility === 'private' || ['draft', 'archived'].includes(row.status)) return null;
  const link = ch.kind === 'series' ? `/${row.slug}?tab=chat` : `/series/${row.series.slug}/${row.slug}?tab=chat`;
  return { c, ch, link };
}

// A series' or an edition's chat for its page.
async function levelBox(req, res, kind, id) {
  if (!req.user) return null;
  const c = `${kind === 'series' ? 's' : 'x'}${id}`;
  return box(req, res, c, kind, `/chat/send?c=${c}`, `/chat/stream?c=${c}`);
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

const sendGlobal = async (req, res, next) => { const sel = await levelChannel(req).catch(() => null); return sel ? send(req, res, next, sel.c, null, sel.link) : forbidden(next); };

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

// The event's chat page: everyone's room and the reviewers' room, as tabs of one card.
async function eventPage(req, res, next) {
  try {
    const rooms = eventRooms(req);
    const room = req.query.room === 'jury' && rooms.jury ? 'jury' : rooms.event ? 'event' : rooms.jury ? 'jury' : null;
    if (!room) return next();
    const q = room === 'jury' ? '?room=jury' : '';
    res.render('pages/contest/chat', {
      title: `${req.t('Chat')} — ${req.contest.title}`,
      room, rooms,
      chatBox: await box(req, res, rooms[room], room, `${req.base}/chat/send${q}`, `${req.base}/chat/stream${q}`),
    });
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

// A small chat box for another page (the Patrol room, the review window).
async function embed(req, res, room) {
  const rooms = eventRooms(req);
  const channel = rooms[room];
  if (!channel || !req.user) return null;
  const q = room === 'jury' ? '?room=jury' : '';
  const b = await box(req, res, channel, room, `${req.base}/chat/send${q}`, `${req.base}/chat/stream${q}`);
  b.room = room;
  return b;
}

async function clearAction(req, res, next, channel) {
  try {
    if (!isSuperuser(req)) return forbidden(next);
    const n = await chat.clear(req.body.all === '1' && !req.contest ? null : channel);
    req.flash('success', req.t('{n} messages deleted.', { n }));
    const back = String(req.body.back || '');
    res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : req.get('Referer') || '/');
  } catch (err) { next(err); }
}
const clearGlobal = async (req, res, next) => { const sel = await levelChannel(req).catch(() => null); return sel || req.body.all === '1' ? clearAction(req, res, next, sel && sel.c) : forbidden(next); };
const eventClear = (req, res, next) => { const sel = eventRoom(req); return sel ? clearAction(req, res, next, sel.channel) : forbidden(next); };

module.exports = { eventPage, eventDownload, levelDownload, levelBox, eventRooms, clearGlobal, eventClear, isSuperuser, stream, sendGlobal, hideGlobal, eventStream, eventSend, eventHide, embed };
