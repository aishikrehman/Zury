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
router.post('/admin/permissions', requirePermission('maintainSite'), adminController.setRolePermission);
router.post('/admin/permissions/reset', requirePermission('maintainSite'), adminController.resetRolePermissions);
router.get('/admin/database', requirePermission('viewDatabase'), require('../controllers/databaseController').index);
router.get('/admin/maintenance', requirePermission('maintainSite'), adminController.maintenancePage);
router.post('/admin/maintenance/backup', requirePermission('maintainSite'), adminController.downloadBackup);
router.post('/admin/maintenance/clean/:task(sessions|activity)', requirePermission('maintainSite'), adminController.cleanUp);

module.exports = router;
