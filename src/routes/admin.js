const express = require('express');
const adminController = require('../controllers/adminController');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use('/admin', requirePermission('accessAdmin'));

router.get('/admin', adminController.index);
router.get('/admin/users', adminController.users);
router.post('/admin/users/:userId(\\d+)/roles', requirePermission('managePlatformRoles'), adminController.grantRole);
router.post('/admin/users/:userId(\\d+)/delete', requirePermission('deleteAnything'), adminController.deleteUser);
router.post('/admin/users/:userId(\\d+)/roles/revoke', requirePermission('managePlatformRoles'), adminController.revokeRole);
router.get('/admin/events', adminController.events);
router.post('/admin/events/:contestId(\\d+)/hold', requirePermission('deleteAnything'), adminController.holdEvent);
router.post('/admin/events/:contestId(\\d+)/delete', requirePermission('deleteAnything'), adminController.deleteEvent);
router.post('/admin/events/:contestId(\\d+)/purge', requirePermission('deleteAnything'), adminController.purgeEvent);
router.get('/admin/permissions', adminController.permissions);
router.get('/admin/features', requirePermission('maintainSite'), (req, res) => res.render('pages/admin/features', { title: 'Features', saved: req.query.saved === '1', SWITCHES: require('../services/featureService').SWITCHES, NUMBERS: require('../services/featureService').NUMBERS }));
router.post('/admin/features', requirePermission('maintainSite'), async (req, res, next) => {
  try {
    await require('../services/featureService').save(req.body);
    await require('../services/auditService').record({ actorId: req.user.id, action: 'site.features', entityType: 'Site', entityId: 0, details: req.body }).catch(() => null);
    res.redirect('/admin/features?saved=1');
  } catch (err) { next(err); }
});
router.post('/admin/permissions', requirePermission('maintainSite'), adminController.setRolePermission);
router.post('/admin/permissions/reset', requirePermission('maintainSite'), adminController.resetRolePermissions);
router.get('/admin/database', requirePermission('viewDatabase'), require('../controllers/databaseController').index);
router.post('/admin/database/:table([A-Za-z]+)/:id/remove', requirePermission('maintainSite'), require('../controllers/databaseController').removeRow);
router.post('/admin/maintenance/backup', requirePermission('maintainSite'), adminController.downloadBackup);
router.post('/admin/maintenance/clean/:task(sessions|activity)', requirePermission('maintainSite'), adminController.cleanUp);

module.exports = router;
