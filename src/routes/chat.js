// Series and edition chats (?c=s<id> or x<id>); an event's rooms live under the event (routes/events.js).
const express = require('express');
const chatController = require('../controllers/chatController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/chat/stream', requireAuth, chatController.stream);
router.get('/chat/panel', requireAuth, chatController.levelPanel);
router.get('/inbox', requireAuth, require('../controllers/inboxController').page);
router.get('/inbox/news.json', (req, res, next) => (req.user ? next() : res.status(401).json({ signedOut: true })), require('../controllers/inboxController').news);
router.get('/mass', requireAuth, require('../controllers/massController').page);
router.post('/mass', requireAuth, require('../controllers/massController').send);
router.post('/inbox/new', requireAuth, require('../controllers/inboxController').start);
router.get('/chat/download', requireAuth, chatController.levelDownload);
router.post('/chat/send', requireAuth, chatController.sendGlobal);
router.post('/chat/clear', requireAuth, chatController.clearGlobal);
router.post('/chat/:id(\\d+)/hide', requireAuth, chatController.hideGlobal);
module.exports = router;
