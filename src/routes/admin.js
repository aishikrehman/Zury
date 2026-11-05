const express = require('express');
const adminController = require('../controllers/adminController');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use('/admin', requirePermission('accessAdmin'));

router.get('/admin', adminController.index);
router.get('/admin/users', adminController.users);
router.post('/admin/users/:userId(\\d+)/roles', requirePermission('managePlatformRoles'), adminController.grantRole);
router.post('/admin/users/:userId(\\d+)/roles/revoke', requirePermission('managePlatformRoles'), adminController.revokeRole);
router.get('/admin/permissions', adminController.permissions);
router.post('/admin/permissions', requirePermission('maintainSite'), adminController.setRolePermission);
router.post('/admin/permissions/reset', requirePermission('maintainSite'), adminController.resetRolePermissions);
router.get('/admin/database', requirePermission('viewDatabase'), require('../controllers/databaseController').index);
router.get('/admin/logs', requirePermission('viewAuditLog'), adminController.logs);
router.get('/admin/maintenance', requirePermission('maintainSite'), adminController.maintenancePage);
router.post('/admin/maintenance/backup', requirePermission('maintainSite'), adminController.downloadBackup);
router.post('/admin/maintenance/clean/:task(sessions|activity)', requirePermission('maintainSite'), adminController.cleanUp);

module.exports = router;
