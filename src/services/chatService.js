// Chat lives only on its own page: an event ("e<id>"), the event's reviewers and organizers
// ("j<id>"), a series ("s<id>") or an edition ("x<id>"). New messages reach open pages at once (server-sent events).
// Against spam: signed-in only, a few messages a minute, no repeats, few links, short messages;
// blocked people cannot write; moderators can hide a message; anyone can delete their own.
const prisma = require('../config/prisma');
const notifications = require('./notificationService');

const bus = require('./liveBus');

const MAX_LEN = 1000;
const MAX_LINKS = 2;
const recent = new Map(); // userId → [{ at, body }]

class ChatError extends Error {}

const dm = (a, b) => `d${Math.min(a, b)}.${Math.max(a, b)}`;
function parseChannel(c) {
  c = String(c || '');
  const d = c.match(/^d(\d+)\.(\d+)$/);
  if (d && Number(d[1]) < Number(d[2])) return { kind: 'direct', users: [Number(d[1]), Number(d[2])] };
  const m = c.match(/^([ejsx])(\d+)$/);
  if (!m) return null;
  return { kind: { e: 'event', j: 'jury', s: 'series', x: 'edition' }[m[1]], id: Number(m[2]), contestId: Number(m[2]) };
}

// Spam rules: at most 5 messages in 15 seconds and 30 in 10 minutes; the same text not twice in a minute.
function checkPace(userId, body) {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((x) => now - x.at < 10 * 60000);
  if (list.filter((x) => now - x.at < 15000).length >= 5 || list.length >= 30) throw new ChatError('You are writing too fast. Wait a little.');
  if (list.some((x) => now - x.at < 60000 && x.body === body)) throw new ChatError('You just sent that.');
  list.push({ at: now, body });
  recent.set(userId, list);
}

function clean(body) {
  body = String(body || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) throw new ChatError('Write a message.');
  if (body.length > MAX_LEN) throw new ChatError('At most 1000 characters.');
  if ((body.match(/https?:\/\//g) || []).length > MAX_LINKS) throw new ChatError('At most two links in a message.');
  return body;
}

async function withUsers(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.userId]))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatarUrl: true, lastLoginAt: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, user: by.get(r.userId) || { id: r.userId, username: '?' } }));
}

// The latest messages (or those before an id), oldest first.
async function list(channel, { before = null, after = null, take = 50 } = {}) {
  const rows = await prisma.chatMessage.findMany({
    where: { channel, ...(before && { id: { lt: before } }), ...(after && { id: { gt: after } }) },
    orderBy: { id: after ? 'asc' : 'desc' },
    take,
  });
  return withUsers(after ? rows : rows.reverse());
}

async function post({ user, channel, body, contest = null, link = '' }) {
  if (!user || user.status === 'blocked') throw new ChatError('You cannot write here.');
  body = clean(body);
  const ch = parseChannel(channel);
  if (!ch) throw new ChatError('Unknown chat.');
  if (contest && (await prisma.eventBlock.count({ where: { contestId: contest.id, userId: user.id, liftedAt: null } }))) throw new ChatError('You cannot write here.');
  checkPace(user.id, body);
  const msg = await prisma.chatMessage.create({ data: { channel, userId: user.id, body } });
  const [full] = await withUsers([msg]);
  bus.emit(channel, full);
  await tell({ user, channel, ch, body, contest, link }).catch(() => null);
  return full;
}

// The other person in a conversation, and people named with @, hear of it (at most once in 10 minutes per chat).
const told = new Map();
async function tell({ user, channel, body, contest, link: given }) {
  const targets = [];
  const dmp = parseChannel(channel);
  if (dmp && dmp.kind === 'direct') targets.push(dmp.users.find((id) => id !== user.id));
  const names = [...body.matchAll(/@([^\s@,.:;!?]{2,85})/g)].map((m) => m[1].replace(/_/g, ' '));
  if (names.length) {
    const found = await prisma.user.findMany({ where: { username: { in: names.slice(0, 5) } }, select: { id: true } });
    targets.push(...found.map((u) => u.id));
  }
  const now = Date.now();
  const fresh = [...new Set(targets)].filter((id) => id && id !== user.id && now - (told.get(`${id}:${channel}`) || 0) > 10 * 60000);
  if (!fresh.length) return;
  fresh.forEach((id) => told.set(`${id}:${channel}`, now));
  const link = given || (contest ? `${contest.path || `/contest/${contest.id}`}/patrol${channel.startsWith('j') ? '?tab=jury' : ''}` : '');
  await notifications.notify(fresh, { kind: 'chat.message', message: dmp && dmp.kind === 'direct' ? '{name} sent you a message.' : '{name} mentioned you in a chat.', params: { name: user.username }, link, contestId: contest ? contest.id : null });
}

// Hidden by a moderator, or deleted by its writer.
async function hide({ actor, id, channel, own }) {
  const m = await prisma.chatMessage.findFirst({ where: { id, channel } });
  if (!m) return null;
  if (own && m.userId !== actor.id) throw new ChatError("You don't have permission to do that.");
  await prisma.chatMessage.update({ where: { id }, data: { hiddenAt: new Date(), hiddenById: actor.id } });
  bus.emit(channel, { id, hidden: true });
  return m;
}

async function markRead(userId, channel, lastId) {
  if (!userId || !lastId) return;
  unreadCache.delete(userId);
  await prisma.chatRead.upsert({ where: { userId_channel: { userId, channel } }, update: { lastId }, create: { userId, channel, lastId } }).catch(() => null);
}

// A live stream of a channel to one open page. Missed messages (after Last-Event-ID) come first.
const openStreams = new Map(); // userId → how many live lines are open
const MAX_STREAMS = 6;
async function stream(req, res, channel, render) {
  const who = req.user ? req.user.id : 0;
  if ((openStreams.get(who) || 0) >= MAX_STREAMS) return res.status(429).end();
  openStreams.set(who, (openStreams.get(who) || 0) + 1);
  req.on('close', () => { const n = (openStreams.get(who) || 1) - 1; if (n > 0) openStreams.set(who, n); else openStreams.delete(who); });
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = async (m) => {
    try {
      if (m.cleared) res.write('event: clear\ndata: 1\n\n');
      else if (m.hidden) res.write(`event: hide\ndata: ${m.id}\n\n`);
      else res.write(`id: ${m.id}\ndata: ${JSON.stringify(await render(m))}\n\n`);
      if (res.flush) res.flush();
    } catch { /* closed */ }
  };
  const since = Number(req.get('Last-Event-ID')) || Number(req.query.after) || 0;
  if (since) for (const m of await list(channel, { after: since, take: 100 })) if (!m.hiddenAt) await send(m);
  bus.on(channel, send);
  const beat = setInterval(() => { res.write(': \n\n'); if (res.flush) res.flush(); }, 25000);
  req.on('close', () => { clearInterval(beat); bus.off(channel, send); });
}

// Chats are kept until their event, series or edition is archived (results final); then deleted.
async function prune() {
  let count = await pruneArchived();
  const days = require('./featureService').now().directDays || DIRECT_DAYS;
  count += (await prisma.chatMessage.deleteMany({ where: { channel: { startsWith: 'd' }, createdAt: { lt: new Date(Date.now() - days * 86400000) } } })).count;
  if (count) await prisma.$executeRawUnsafe('DELETE r FROM ChatRead r LEFT JOIN ChatMessage m ON m.channel = r.channel WHERE m.id IS NULL');
  return count;
}

// A superuser's clear-out: one chat, or every chat when no channel is given.
async function clear(channel = null) {
  const { count } = await prisma.chatMessage.deleteMany({ where: channel ? { channel } : {} });
  await prisma.chatRead.deleteMany({ where: channel ? { channel } : {} });
  if (channel) bus.emit(channel, { cleared: true });
  return count;
}

// The whole chat as plain text, oldest first, for download.
async function exportText(channel, title = '') {
  const rows = await withUsers(await prisma.chatMessage.findMany({ where: { channel, hiddenAt: null }, orderBy: { id: 'asc' } }));
  const stamp = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return [title, ''].concat(rows.map((m) => `[${stamp(m.createdAt)}] ${m.user.username}: ${m.body.replace(/\n/g, '\n    ')}`)).join('\n') + '\n';
}

// The chats of archived events, series and editions are deleted.
async function pruneArchived() {
  const [events, series, editions] = await Promise.all([
    prisma.contest.findMany({ where: { OR: [{ status: 'archived' }, { deletedAt: { not: null } }] }, select: { id: true } }),
    prisma.eventSeries.findMany({ where: { OR: [{ status: 'archived' }, { deletedAt: { not: null } }] }, select: { id: true } }),
    prisma.edition.findMany({ where: { OR: [{ status: 'archived' }, { deletedAt: { not: null } }] }, select: { id: true } }),
  ]);
  const channels = [...events.flatMap((e) => [`e${e.id}`, `j${e.id}`]), ...series.map((s) => `s${s.id}`), ...editions.map((e) => `x${e.id}`)];
  if (!channels.length) return 0;
  const { count } = await prisma.chatMessage.deleteMany({ where: { channel: { in: channels } } });
  await prisma.chatRead.deleteMany({ where: { channel: { in: channels } } });
  return count;
}

// The chat rooms a person belongs to: their events' rooms (the reviewers' room for reviewers and
// organizers), and series and edition rooms they have written in. Newest activity first.
const STAFF_ROLES = ['jury', 'organizer'];
const OLD_DAYS = 90; // events that ended longer ago leave the chat lists
const DIRECT_DAYS = 90; // messages between two people are kept this long

// Two people may write to each other when they share an event (organizers, reviewers or participants).
async function mayWrite(a, b) {
  if (!a || !b || a === b) return false;
  const mine = await prisma.contestMembership.findMany({ where: { userId: a, status: 'active' }, select: { contestId: true } });
  if (!mine.length) return false;
  return (await prisma.contestMembership.count({ where: { userId: b, status: 'active', contestId: { in: mine.map((m) => m.contestId) } } })) > 0;
}
async function myRooms(userId) {
  const F = require('./featureService').now();
  if (!F.chat && !F.juryChat && !F.levelChat && !F.directMessages) return [];
  const OLD = F.oldEventDays || OLD_DAYS;
  const ms = await prisma.contestMembership.findMany({
    where: { userId, status: 'active', contest: { deletedAt: null, status: { notIn: ['draft', 'archived', 'cancelled'] }, OR: [{ endDate: null }, { endDate: { gte: new Date(Date.now() - OLD * 86400000) } }] } },
    select: { role: true, contest: { select: { id: true, title: true, path: true, logoUrl: true, seriesId: true, editionId: true, settings: { select: { extras: true } } } } },
  });
  const extras = require('./extrasService');
  const rooms = new Map();
  for (const m of ms) {
    const c = m.contest; const x = extras.read(c.settings);
    const path = c.path || `/contest/${c.id}`;
    if (F.chat && x.chat) rooms.set(`e${c.id}`, { channel: `e${c.id}`, title: c.title, path, room: 'event', logo: c.logoUrl || null });
    if (F.juryChat && x.juryChat && STAFF_ROLES.includes(m.role)) rooms.set(`j${c.id}`, { channel: `j${c.id}`, title: c.title, path, room: 'jury', logo: c.logoUrl || null });
  }
  const written = !F.levelChat ? [] : await prisma.chatMessage.findMany({ where: { userId, OR: [{ channel: { startsWith: 's' } }, { channel: { startsWith: 'x' } }] }, distinct: ['channel'], select: { channel: true }, take: 50 });
  const sIds = [...new Set([...written.filter((w) => w.channel[0] === 's').map((w) => Number(w.channel.slice(1))), ...(F.levelChat ? ms.map((m) => m.contest.seriesId).filter(Boolean) : [])])];
  const xIds = [...new Set([...written.filter((w) => w.channel[0] === 'x').map((w) => Number(w.channel.slice(1))), ...(F.levelChat ? ms.map((m) => m.contest.editionId).filter(Boolean) : [])])];
  const [series, eds] = await Promise.all([
    sIds.length ? prisma.eventSeries.findMany({ where: { id: { in: sIds }, deletedAt: null, status: { not: 'archived' } }, select: { id: true, title: true, slug: true } }) : [],
    xIds.length ? prisma.edition.findMany({ where: { id: { in: xIds }, deletedAt: null, status: { not: 'archived' } }, select: { id: true, title: true, slug: true, series: { select: { slug: true } } } }) : [],
  ]);
  for (const s of series) rooms.set(`s${s.id}`, { channel: `s${s.id}`, title: s.title, path: `/${s.slug}`, room: 'series' });
  for (const e of eds) rooms.set(`x${e.id}`, { channel: `x${e.id}`, title: e.title, path: `/series/${e.series.slug}/${e.slug}`, room: 'edition' });
  // Conversations between two people.
  const dms = !F.directMessages ? [] : await prisma.$queryRawUnsafe("SELECT DISTINCT channel FROM ChatMessage WHERE channel LIKE ? OR channel LIKE ? LIMIT 100", `d${userId}.%`, `d%.${userId}`);
  const pairs = dms.map((r) => [r.channel, parseChannel(r.channel)]).filter(([, p]) => p && p.users.includes(userId));
  if (pairs.length) {
    const others = await prisma.user.findMany({ where: { id: { in: pairs.map(([, p]) => p.users.find((id) => id !== userId)) } }, select: { id: true, username: true, avatarUrl: true, lastLoginAt: true } });
    for (const [c, p] of pairs) { const o = others.find((u) => u.id === p.users.find((id) => id !== userId)); if (o) rooms.set(c, { channel: c, title: o.username, path: `/users/${encodeURIComponent(o.username)}`, room: 'direct', person: o }); }
  }
  const list = [...rooms.values()];
  if (!list.length) return [];
  const chans = list.map((r) => r.channel);
  const [lasts, reads] = await Promise.all([
    prisma.chatMessage.groupBy({ by: ['channel'], where: { channel: { in: chans } }, _max: { id: true, createdAt: true } }),
    prisma.chatRead.findMany({ where: { userId, channel: { in: chans } } }),
  ]);
  const last = new Map(lasts.map((l) => [l.channel, l._max]));
  const read = new Map(reads.map((r) => [r.channel, r.lastId]));
  for (const r of list) { const l = last.get(r.channel); r.lastAt = l ? l.createdAt : null; r.unread = !!(l && l.id > (read.get(r.channel) || 0)); r.lastId = l ? l.id : null; }
  // Each room's latest message, for the inbox's lines.
  const ids = list.map((r) => r.lastId).filter(Boolean);
  const lastMsgs = ids.length ? await withUsers(await prisma.chatMessage.findMany({ where: { id: { in: ids } } })) : [];
  for (const r of list) { const m = lastMsgs.find((x) => x.id === r.lastId); r.preview = m && !m.hiddenAt ? `${m.user.username}: ${m.body}`.slice(0, 160) : ''; }
  return list.sort((a, b) => (b.lastAt ? +b.lastAt : 0) - (a.lastAt ? +a.lastAt : 0));
}

// How many of a person's rooms have something new (kept a minute, for the header).
const unreadCache = new Map();
async function unreadRoomList(userId) {
  const hit = unreadCache.get(userId);
  if (hit && Date.now() - hit.at < 60000) return hit.list;
  const list = (await myRooms(userId)).filter((r) => r.unread);
  unreadCache.set(userId, { at: Date.now(), list });
  return list;
}
async function unreadRooms(userId) {
  return (await unreadRoomList(userId)).length;
}

// What is new for a person since a time: notifications, and messages by others in their rooms.
const roomsCache = new Map();
async function newsSince(userId, since) {
  const hit = roomsCache.get(userId);
  const rooms = hit && Date.now() - hit.at < 60000 ? hit.rooms : await myRooms(userId);
  if (!hit || hit.rooms !== rooms) roomsCache.set(userId, { at: Date.now(), rooms });
  const byChannel = new Map(rooms.map((r) => [r.channel, r]));
  const [notes, msgs] = await Promise.all([
    prisma.notification.findMany({ where: { userId, createdAt: { gt: since } }, orderBy: { id: 'asc' }, take: 5 }),
    rooms.length ? prisma.chatMessage.findMany({ where: { channel: { in: [...byChannel.keys()] }, userId: { not: userId }, hiddenAt: null, createdAt: { gt: since } }, orderBy: { id: 'asc' }, take: 5 }) : [],
  ]);
  return { notes, msgs: (await withUsers(msgs)).map((m) => ({ ...m, room: byChannel.get(m.channel) })) };
}

module.exports = { unreadRoomList, newsSince, mayWrite, DIRECT_DAYS, myRooms, unreadRooms, exportText, pruneArchived, prune, clear, ChatError, dm, parseChannel, list, post, hide, markRead, stream };
