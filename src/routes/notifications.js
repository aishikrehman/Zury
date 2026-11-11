// The bell: unread count on every page, its menu (loaded when opened), the full list, and
// opening one (marks it read, then goes where it leads).
const express = require('express');
const notifications = require('../services/notificationService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every page: how many are unread (only for signed-in people; one indexed count).
router.use(async (req, res, next) => {
  res.locals.unreadNotifications = 0;
  if (req.user && req.method === 'GET' && req.accepts('html')) {
    res.locals.unreadNotifications = await notifications.unreadCount(req.user.id).catch(() => 0);
  }
  next();
});

const view = (req, res, n) => ({
  id: n.id,
  text: notifications.text(req.t, n),
  href: `/notifications/${n.id}`,
  when: res.locals.formatDateTime ? res.locals.formatDateTime(n.createdAt) : n.createdAt.toISOString(),
  unread: !n.readAt,
  kind: n.kind,
  level: /not accepted|was appealed|blocked|removed/i.test(n.message || '') ? 'urgent' : /accepted|upheld|now /i.test(n.message || '') ? 'good' : 'normal',
});

router.get('/notifications.json', requireAuth, async (req, res, next) => {
  try {
    const [items, unread] = await Promise.all([notifications.latest(req.user.id), notifications.unreadCount(req.user.id)]);
    res.json({ unread, items: items.map((n) => view(req, res, n)) });
  } catch (err) {
    next(err);
  }
});

router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const n = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = await notifications.page(req.user.id, { page: n });
    res.render('pages/account/notifications', { title: 'Notifications — Zury', ...result, items: result.items.map((x) => view(req, res, x)) });
  } catch (err) {
    next(err);
  }
});

router.get('/notifications/:id(\\d+)', requireAuth, async (req, res, next) => {
  try {
    const n = await notifications.open(req.user.id, Number(req.params.id));
    // Only addresses inside Zury.
    res.redirect(n && n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/notifications');
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    await notifications.markAllRead(req.user.id);
    if (req.accepts(['json', 'html']) === 'json') return res.json({ ok: true });
    res.redirect('/notifications');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
