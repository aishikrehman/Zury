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

// No mass messages: leaves this person out of wiki messages sent to many people at once.
router.post('/account/mass-messages', require('../middleware/auth').requireAuth, async (req, res, next) => {
  try {
    const prisma = require('../config/prisma');
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { uiPrefs: true } });
    let p = {}; try { p = JSON.parse(u.uiPrefs || '{}') || {}; } catch { p = {}; }
    p.noMass = req.body.noMass === 'on';
    await prisma.user.update({ where: { id: req.user.id }, data: { uiPrefs: JSON.stringify(p) } });
    req.flash('success', p.noMass ? 'You will not get mass messages.' : 'You will get mass messages again.');
    res.redirect(req.get('Referer') || '/account');
  } catch (err) { next(err); }
});
