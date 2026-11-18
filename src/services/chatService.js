// Chat lives only on its own page: an event ("e<id>"), the event's reviewers and organizers
// ("j<id>"), a series ("s<id>") or an edition ("x<id>"). New messages reach open pages at once (server-sent events).
// Against spam: signed-in only, a few messages a minute, no repeats, few links, short messages;
// blocked people cannot write; moderators can hide a message; anyone can delete their own.
const { EventEmitter } = require('events');
const prisma = require('../config/prisma');
const notifications = require('./notificationService');

const bus = new EventEmitter();
bus.setMaxListeners(0);

const MAX_LEN = 1000;
const MAX_LINKS = 2;
const recent = new Map(); // userId → [{ at, body }]

class ChatError extends Error {}

const dm = (a, b) => `d${Math.min(a, b)}.${Math.max(a, b)}`;
function parseChannel(c) {
  c = String(c || '');
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
  await notifications.notify(fresh, { kind: 'chat.message', message: '{name} mentioned you in a chat.', params: { name: user.username }, link, contestId: contest ? contest.id : null });
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
  await prisma.chatRead.upsert({ where: { userId_channel: { userId, channel } }, update: { lastId }, create: { userId, channel, lastId } }).catch(() => null);
}

// A live stream of a channel to one open page. Missed messages (after Last-Event-ID) come first.
async function stream(req, res, channel, render) {
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
  const count = await pruneArchived();
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

module.exports = { exportText, pruneArchived, prune, clear, ChatError, dm, parseChannel, list, post, hide, markRead, stream };
