const express = require('express');
const accountController = require('../controllers/accountController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireAuth, accountController.dashboard);
router.post('/approvals/:kind(event|series|edition)/:id(\\d+)/:action(approve|reject)', requireAuth, accountController.approval);
router.get('/settings', requireAuth, accountController.showSettings);
router.post('/settings', requireAuth, accountController.updateSettings);
router.post('/settings/avatar', requireAuth, accountController.updateAvatar);

module.exports = router;
