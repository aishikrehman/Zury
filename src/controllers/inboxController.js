// Notifications (/notifications) and chats (/inbox): two pages with one look (a mailbox), and a
// switch between them; the live line that brings toasts to every page.
const prisma = require('../config/prisma');
const chat = require('../services/chatService');
const notifications = require('../services/notificationService');
const chatController = require('./chatController');

const PER_PAGE = 25;

async function page(req, res, next) {
  try {
    const mode = req.path.startsWith('/notifications') ? 'notes' : 'chats';
    if (mode === 'chats' && !res.locals.features.inbox) return res.redirect('/notifications');
    const [rooms, unreadNotes] = await Promise.all([chat.myRooms(req.user.id), notifications.unreadCount(req.user.id)]);
    let open = null; let chatBox = null; let notes = null;
    let f = mode === 'notes' ? (req.query.f === 'unread' ? 'unread' : 'all') : (['chats', 'direct'].includes(req.query.f) ? req.query.f : 'chats');
    if (mode === 'chats') {
      const c = String(req.query.c || '');
      open = rooms.find((r) => r.channel === c) || null;
      const dm = chat.parseChannel(c);
      if (!open && dm && dm.kind === 'direct' && dm.users.includes(req.user.id)) {
        const o = await prisma.user.findUnique({ where: { id: dm.users.find((id) => id !== req.user.id) }, select: { id: true, username: true, avatarUrl: true, lastLoginAt: true } });
        if (o && await chat.mayWrite(req.user.id, o.id)) open = { channel: c, title: o.username, path: `/users/${encodeURIComponent(o.username)}`, room: 'direct', person: o };
      }
      if (open) { chatBox = await chatController.box(req, res, open.channel, open.room, open.path); open.unread = false; if (open.room === 'direct') f = 'direct'; }
    } else {
      const n = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const where = { userId: req.user.id, ...(f === 'unread' && { readAt: null }) };
      const [items, total] = await Promise.all([prisma.notification.findMany({ where, orderBy: { id: 'desc' }, skip: (n - 1) * PER_PAGE, take: PER_PAGE }), prisma.notification.count({ where })]);
      const evIds = [...new Set(items.map((x) => x.contestId).filter(Boolean))];
      const evs = evIds.length ? await prisma.contest.findMany({ where: { id: { in: evIds } }, select: { id: true, title: true } }) : [];
      notes = { page: n, perPage: PER_PAGE, total, items: items.map((x) => ({ id: x.id, text: notifications.text(req.t, x), when: x.createdAt, unread: !x.readAt, event: (evs.find((e) => e.id === x.contestId) || {}).title || '' })) };
    }
    res.render('pages/account/inbox', { title: mode === 'notes' ? 'Notifications' : 'Inbox', mode, rooms, open, chatBox, notes, unreadNotes, f });
  } catch (err) { next(err); }
}

// What is new since the page last asked (for toasts and the header): a small JSON answer.
async function news(req, res, next) {
  try {
    const since = new Date(Math.max(Number(req.query.since) || 0, Date.now() - 10 * 60000));
    const [{ notes, msgs }, unreadNotes, unreadRooms] = await Promise.all([chat.newsSince(req.user.id, since), notifications.unreadCount(req.user.id), chat.unreadRooms(req.user.id)]);
    const liveChat = res.locals.features.liveChat;
    res.set('Cache-Control', 'no-store').json({
      now: Date.now(), liveChat, unreadNotes, unreadRooms,
      notes: notes.map((n) => ({ text: notifications.text(req.t, n), link: `/notifications/${n.id}` })),
      chats: (liveChat ? msgs : []).map((m) => ({ channel: m.channel, title: m.room ? m.room.title : '', who: m.user.username, text: String(m.body).slice(0, 140), link: `/inbox?c=${m.channel}` })),
    });
  } catch (err) { next(err); }
}

// A new conversation with someone the person shares an event with.
async function start(req, res, next) {
  try {
    if (!res.locals.features.directMessages) return res.redirect('/inbox');
    const name = String(req.body.username || '').replace(/^(User|ব্যবহারকারী):/i, '').replace(/_/g, ' ').trim();
    const other = name && await prisma.user.findFirst({ where: { username: name }, select: { id: true } });
    if (!other || !(await chat.mayWrite(req.user.id, other.id))) {
      req.flash('danger', 'You can write to someone who takes part in an event with you.');
      return res.redirect(req.get('Referer') || '/inbox');
    }
    res.redirect(`/inbox?c=d${Math.min(req.user.id, other.id)}.${Math.max(req.user.id, other.id)}`);
  } catch (err) { next(err); }
}

module.exports = { page, news, start };
