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
router.get('/admin/logs', requirePermission('viewAuditLog'), adminController.logs);

module.exports = router;
